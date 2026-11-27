// Entitlement Authorizer for GitHub Actions
const { appendFileSync } = require('node:fs');

async function main() {
  const oidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const oidcToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const controlPlaneUrl = (
    process.env.CONTROL_PLANE_URL ||
    process.env.MYCO_CONTROL_PLANE_URL ||
    'https://myco-backend-8t13.onrender.com'
  ).replace(/\/+$/, '');
  const audience =
    process.env.OIDC_AUDIENCE ||
    process.env.MYCO_OIDC_AUDIENCE ||
    'https://myco.intelligence';
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  if (!oidcUrl || !oidcToken) {
    console.error('::error::Missing GitHub Actions OIDC token environment. Ensure "permissions: id-token: write" is enabled.');
    process.exit(1);
  }

  try {
    const url = new URL(oidcUrl);
    url.searchParams.set('audience', audience);

    const oidcRes = await fetch(url, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${oidcToken}` },
    });

    if (!oidcRes.ok) {
      throw new Error(`GitHub OIDC token request failed (HTTP ${oidcRes.status})`);
    }

    const { value: rawToken } = await oidcRes.json();
    if (!rawToken) throw new Error('Empty OIDC token received from GitHub');

    const authRes = await fetch(`${controlPlaneUrl}/api/v1/entitlements/authorize`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oidc_token: rawToken,
        repository,
        run_id: runId,
      }),
    });

    const data = await authRes.json().catch(() => ({}));

    if (!authRes.ok || !data.authorized) {
      const code = data.code || `HTTP_${authRes.status}`;
      const reason = data.reason || data.error?.message || data.message || 'Authorization rejected by Myco Control Plane';
      console.error(`::error::Myco Authorization Denied [${code}]: ${reason}`);
      console.error('Please verify that the repository is connected in Myco and an active seat is assigned to the PR author.');
      process.exit(1);
    }

    const grantToken = data.grant_token;
    const clientId = data.customer_id || data.client_id;

    if (!grantToken || !clientId) {
      throw new Error('Invalid authorization grant: missing grant_token or client_id');
    }

    // Mask secret grant token
    console.log(`::add-mask::${grantToken}`);

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `grant=${grantToken}\nclient_id=${clientId}\nmetrics_endpoint=${controlPlaneUrl}/api/ingest-metrics\n`
      );
    }

    if (process.env.GITHUB_ENV) {
      appendFileSync(
        process.env.GITHUB_ENV,
        `METRICS_API_KEY=${grantToken}\nCLIENT_ID=${clientId}\nMETRICS_ENDPOINT=${controlPlaneUrl}/api/ingest-metrics\nMYCO_METRICS_ENDPOINT=${controlPlaneUrl}/api/ingest-metrics\n`
      );
    }

    console.log(`✅ Myco review access authorized for ${repository} (Customer ID: ${clientId})`);
  } catch (err) {
    console.error(`::error::Authorization Error: ${err.message || err}`);
    process.exit(1);
  }
}

main();
