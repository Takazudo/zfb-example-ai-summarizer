# Cloudflare setup

An ordered walkthrough from zero to a deployed Worker. **This repo is not
deployed yet** — it has no Cloudflare secrets set, and the `deploy` job in
`.github/workflows/deploy.yml` self-skips until they exist. Nothing below
assumes a previous deploy.

The README's [Cloudflare Workers AI](../README.md#cloudflare-workers-ai) and
[Continuous deployment](../README.md#continuous-deployment-github-actions)
sections stay the reference for what the pieces are. This document is the order
to do them in.

What you are deploying: a Cloudflare Worker serving the built static assets,
plus a `pages/api/summarize.tsx` request-time route backed by a Workers AI
binding. There is no resource to provision first — Workers AI is an account
feature, not a resource with an id — and the Worker itself is created by the
first deploy.

## 1. Create or reuse the Cloudflare API token

All nine `zfb-example-*` repos share **one** account-scoped token. If you have
already made it for another example repo, reuse it and skip to step 2 — see
[the family-wide token guide][shared-token] for how that token is built and
which repos use it.

[shared-token]: https://github.com/Takazudo/zfbex-tweaker/blob/main/docs/cloudflare-shared-token-and-env-setup.md

Otherwise create a custom token in the Cloudflare dashboard under **My Profile
→ API Tokens → Create Custom Token** with these permissions:

| Scope | Permission | Level |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Workers AI | Read |
| Account | Account Settings | Read |

Set **Account Resources → Include → (your account)**. No Zone permissions are
needed — this repo deploys to a `*.workers.dev` host, not a custom domain.

You also need your **account id**, shown on the Cloudflare dashboard account
home page (or via `pnpm exec wrangler whoami` once logged in).

## 2. Set the two GitHub Actions secrets

The deploy job reads both from repo secrets:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo Takazudo/zfb-example-ai-summarizer
gh secret set CLOUDFLARE_ACCOUNT_ID --repo Takazudo/zfb-example-ai-summarizer
```

Each command prompts for the value. Confirm both landed:

```sh
gh secret list --repo Takazudo/zfb-example-ai-summarizer
```

There are no Worker secrets (`wrangler secret put`) to set — the AI binding
needs no credentials of its own.

## 3. Trigger the first deploy

The first `wrangler deploy` is what **creates** the Worker; you do not create it
in the dashboard beforehand. Push to `main` and the workflow does it:

```sh
git commit --allow-empty -m "chore: trigger first Cloudflare deploy"
git push origin main
```

The deploy job runs `pnpm exec wrangler deploy --env ai`. The `--env ai` part
matters: the `AI` binding lives in the named `ai` Wrangler environment, so the
deployed Worker takes that environment's name:

```toml
[env.ai]
name = "zfb-example-ai-summarizer-ai"

[env.ai.ai]
binding = "AI"
```

The Worker is therefore **`zfb-example-ai-summarizer-ai`**, not
`zfb-example-ai-summarizer`. Watch the run:

```sh
gh run watch --repo Takazudo/zfb-example-ai-summarizer
```

You can also deploy from your machine instead, after `wrangler login`:

```sh
pnpm build
pnpm exec wrangler deploy --env ai
```

## 4. Verify the live URL

Wrangler prints the deployed URL at the end of a successful deploy — take it
from there, since it depends on your account's `workers.dev` subdomain. For the
`takazudo` subdomain it is:

```
https://zfb-example-ai-summarizer-ai.takazudo.workers.dev
```

Load that page for the UI, then check the API route directly:

```sh
curl -X POST https://zfb-example-ai-summarizer-ai.takazudo.workers.dev/api/summarize \
  -H "content-type: application/json" \
  -d '{"text":"zfb renders static pages by default and uses prerender = false for request-time routes."}'
```

A working Workers AI binding returns `"fallback": false` and the model id:

```json
{ "summary": "…", "fallback": false, "model": "@cf/meta/llama-3.2-1b-instruct" }
```

If the response instead contains `"fallback": true` and a `reason`, the route
worked but the AI call did not — see below.

## Troubleshooting

**Deploy job skipped.** The workflow ran but the `Deploy` step did not. Its
preflight found no `CLOUDFLARE_API_TOKEN` and logged a notice saying so. The
secrets from step 2 are missing or were set on the wrong repo — re-check with
`gh secret list`.

**`"fallback": true, "reason": "ai-run-failed"`.** The binding is present but
the model call failed. Check that the token carried **Workers AI — Read** when
you deployed, and that Workers AI is enabled on the account. This is the useful
diagnostic signal: the route degrades to a deterministic local summary rather
than erroring, so a `fallback` response means "deployed and serving, AI not
reachable" — not "broken deploy".

**`"fallback": true, "reason": "missing-ai-binding"`.** The Worker has no `AI`
binding at all, which means it was deployed **without** `--env ai` — you are
most likely hitting the plain `zfb-example-ai-summarizer` Worker instead of
`zfb-example-ai-summarizer-ai`. Re-deploy with `--env ai` and confirm the URL
hostname ends in `-ai`.

**404 on the deployed URL.** The subdomain in the URL is wrong, or the Worker
name is not the `-ai` one. Run `pnpm exec wrangler deployments list --env ai` to
see what actually exists.

**Deploy fails with an authentication or permission error.** The token is
missing **Workers Scripts — Edit**, or **Account Resources → Include** was not
set to the account that `CLOUDFLARE_ACCOUNT_ID` points at.
