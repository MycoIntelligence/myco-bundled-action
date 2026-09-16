# myco-bundled-action

Bundled, distributable build of the Myco PR Reviewer agent, packaged as a GitHub composite action.

This repo exists so pilot clients can consume the reviewer with a single line in their own
workflow — `uses: MycoIntelligence/myco-bundled-action@v1`. The source of truth lives in
the private [`Myco-backend`](https://github.com/MycoIntelligence/Myco-backend) repository.
`dist/index.js` here is a built artifact (via `@vercel/ncc`), not source to edit directly —
make changes in `Myco-backend` and re-publish here.

## Access

This action repository is currently public, so a client can reference it directly from its
own workflow. The bundled file is minified, but it is not a security boundary: anyone can
inspect its strings and behavior. Do not place provider keys, client data, or proprietary
logic in this repository.

## Usage

```yaml
name: Myco PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  issues: write   # only needed if you use ticket_provider: github-issues

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: MycoIntelligence/myco-bundled-action@v1
        with:
          pr_link: ${{ github.event.pull_request.html_url }}
          llm_provider: ${{ vars.LLM_PROVIDER || 'openai' }}   # optional: set once as a repo/org Variable; action falls back to "openai" when unset
          api_key: ${{ secrets.LLM_API_KEY }}
          # litellm_base_url defaults to https://api.openai.com/v1 (only used when llm_provider is "openai") —
          # override if you're using a different OpenAI-compatible provider or a LiteLLM proxy.
          # litellm_model defaults to gpt-4.1 (only used when llm_provider is "openai").
```

**Why `vars.LLM_PROVIDER` instead of writing `llm_provider: anthropic` inline**: `api_key` is the same
input regardless of provider, so switching providers is a one-line change in **Settings → Secrets and
variables → Actions → Variables** — no workflow YAML edit at all, and no way to flip the provider without
also updating which input the key goes under (that exact mismatch — provider changed, key left under the
old provider-specific input — is what caused a confusing wrong-endpoint 401 in early testing). Leave
`llm_provider` unset in your `with:` block defaults to `"openai"` -- but that default lives in this
action's own definition, which has no way to read *your* repo's Variables on its own. `vars.LLM_PROVIDER`
only resolves because your workflow evaluates it and passes the result in as the `llm_provider` input --
so the line has to be in your `with:` block (as shown above) for a repo/org Variable to have any effect.
Omitting `llm_provider` entirely, or passing an empty value, both just fall through to `"openai"`.

(A raw Gemini key doesn't need `llm_provider: anthropic` — Gemini has its own OpenAI-compatible endpoint, so
it already works through the default `openai` path via `litellm_base_url`.)

**Mismatched key and provider fails fast with a clear message.** An Anthropic key (`sk-ant-...`) under
`llm_provider: openai` (or an OpenAI-style key under `llm_provider: anthropic`) is rejected before any
network call, naming the exact fix, instead of surfacing as a generic 401 from the wrong provider's API.

**"This API key is not scoped to a workspace" error?** Some Anthropic keys aren't tied to a single
workspace, and every request 400s with that exact message until one is specified -- this is enforced by
Anthropic's API itself, not something we can route around. Either regenerate the key with a specific
workspace selected in the Anthropic Console (simplest fix, no config needed), or add
`anthropic_workspace_id: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}` (only used when `llm_provider: anthropic`)
to send it as the header the API is asking for. If you hit this without setting `anthropic_workspace_id`,
the error is caught and rewritten into this same actionable message rather than surfacing as a raw
Anthropic SDK stack trace.

**Legacy inputs, still supported**: `litellm_api_key` and `anthropic_api_key` still work exactly as
before and take precedence over `api_key` if you set them explicitly — nothing breaks if you're already
using them. `api_key` is just the simpler path for anyone setting up fresh, or switching providers later.

`github_token` defaults to the workflow's automatic `secrets.GITHUB_TOKEN`, which is enough
for reviewing PRs in the same repo the workflow runs in (posting comments, and — if
`ticket_provider: github-issues` — filing issues there too). No GitHub App or extra token is
needed for the common case.

## Intent checking

Before reviewing the diff, the agent reads the PR description as the author's
stated intent, and — if the description contains links — fetches them
(up to 3, best-effort, 8s timeout each) and includes what it can read as
additional intent context. It then checks whether the implementation
actually matches what was described, and flags any mismatch as its own
finding (titled `Intent mismatch: ...`), posted as an inline PR comment the
same as any other finding — no separate setup needed.

**Real limitation, not glossed over**: most linked docs teams actually use —
Notion, Linear, Jira Cloud, Confluence — are either behind auth (an
unauthenticated fetch hits a login wall) or client-rendered (the raw HTML
has no real content until JavaScript runs, which this doesn't do). This
reliably gets usable content from plain text/markdown files, public raw
GitHub content, and simple server-rendered pages — not from a private
Notion doc link. When a link can't be read, the agent is told exactly that
("referenced but unread") rather than silently treating it as empty or
guessing its content. If your team's specs live in one of those tools, the
PR description text itself is what actually reaches the model — a
description that restates the key intent in plain text will get checked
properly even if the linked doc itself can't be fetched.

If your org's CI shouldn't make outbound calls to arbitrary URLs found in
PR text, set `follow_intent_links: false` — the PR description itself is
still used for intent checking either way.

## Inputs

See [`action.yml`](./action.yml) for the full, current list with defaults — this is a summary.

| Input | Required | Default | Notes |
|---|---|---|---|
| `pr_link` | yes | — | Full PR (or compare) URL to review |
| `llm_provider` | no | `openai` | `openai` (any OpenAI-compatible endpoint) or `anthropic` (native Anthropic key) — recommend sourcing from a repo/org Variable: `${{ vars.LLM_PROVIDER }}` |
| `api_key` | recommended | — | API key for whichever `llm_provider` is set — one input regardless of provider |
| `litellm_api_key` | legacy, if `llm_provider: openai` and `api_key` unset | — | Your LLM provider's API key (prefer `api_key`) |
| `litellm_base_url` | no | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `litellm_model` | no | `gpt-4.1` | |
| `anthropic_api_key` | legacy, if `llm_provider: anthropic` and `api_key` unset | — | Native Anthropic API key (prefer `api_key`) |
| `anthropic_model` | no | — | Only used with `llm_provider: anthropic` |
| `anthropic_workspace_id` | no | — | Only needed if your Anthropic key is not scoped to a workspace (see error note above). Only used with `llm_provider: anthropic` |
| `validator_model` | no | same as the main model | Optional cheaper/faster model for the validator pass |
| `github_token` | no | `${{ github.token }}` | Only override for cross-repo scenarios |
| `min_severity` | no | `P3` | Lowest severity reported |
| `follow_intent_links` | no | `true` | Fetch links in the PR description (best-effort) and check the implementation against the stated intent — see "Intent checking" below |
| `post_github_comments` | no | `true` | |
| `validate_findings` | no | `true` | Second-pass CONFIRMED/FALSE_POSITIVE/UNCERTAIN check |
| `ci_gate` | no | `true` | Fail the job on a merge-blocking confirmed finding |
| `gate_min_severity` | no | `P1` | Severity threshold for the gate |
| `ticket_provider` | no | — | `jira`, `github-issues`, or `dry-run` |
| `create_tickets_for` | no | `merge-blocking` | or `all-confirmed` |
| `product_label` | no | `myco` | Base label on created tickets — override per-client if they want their own label scheme |
| `metrics_endpoint` / `metrics_api_key` / `client_id` | yes | — | Required Myco metrics reporting. `metrics_api_key` must match the Supabase `METRICS_INGEST_KEY`; counts + finding titles only, never file paths, root cause, fix text, or code. |

Jira-specific inputs (`jira_base_url`, `jira_email`, `jira_token`, `jira_project`,
`jira_issue_type`, `jira_labels`, `jira_assignee_account_id`) and GitHub-Issues-specific
inputs (`github_issue_labels`, `ticket_github_repo`) are only needed when using that ticket
provider.

## Publishing an update

From the `Myco-backend` repo:

```bash
npx @vercel/ncc build src/index.ts -o dist -m
```

The `-m` flag minifies the bundle — mangled variable/function names, no
whitespace or comments. It's not real code protection (string literals,
including the LLM prompts, are unaffected by minification and remain
plainly readable if someone opens the file), but it raises the bar past
"trivially readable" for casual inspection. Don't drop the flag on a future
rebuild without a reason.

Copy the resulting `dist/index.js` here, update `action.yml` if any input/env mapping
changed, then commit **and push**:

```bash
git add dist/index.js action.yml README.md
git commit -m "..."
git push origin main
```

**Then move the `v1` tag — this step is easy to forget and breaks every client's
CI when it's skipped** (a `uses: .../myco-bundled-action@v1` reference resolves
against an actual tag/branch named `v1`; if it doesn't exist at all, the error is
`unable to find version 'v1'` — if it exists but wasn't moved, clients silently
keep running the old bundle):

```bash
git tag -f v1 main
git push origin v1 --force
```

Or just run `./publish.sh` (bash) / `.\publish.ps1` (PowerShell) after the
`git commit` above — either one pushes main and moves+force-pushes `v1` in
one step, so the tag-move can't be forgotten.

**Windows note**: if `.\publish.ps1` fails with *"running scripts is
disabled on this system"*, your machine's PowerShell execution policy is
blocking unsigned local scripts (a common default, unrelated to this repo).
Either run it once with `powershell -ExecutionPolicy Bypass -File
.\publish.ps1`, or just run `publish.cmd` instead — a small wrapper that
does the same thing without touching your machine's execution policy at
all.
