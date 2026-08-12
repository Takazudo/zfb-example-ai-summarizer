# zfb-example-ai-summarizer

A compact zfb app with a Preact island UI and a `pages/api/summarize.tsx`
Worker route backed by a Cloudflare Workers AI binding.

## Local Development

Install dependencies:

```sh
pnpm install
```

Fast UI loop:

```sh
pnpm dev
```

`pnpm dev` is the fast loop for the **UI only**. `zfb dev` renders pages from an
SSG runtime that has no Worker request scope, so `pages/api/summarize.tsx` cannot
read the incoming request there and answers `503` pointing you at the commands
below. Use it for the island and the styling, not for the endpoint.

Production build:

```sh
pnpm build
```

Preview:

```sh
pnpm preview
```

Because this project configures the Cloudflare adapter, `zfb preview` hands off
to `wrangler dev` after the build. That is a real Worker runtime, so the API
route works here. The default Wrangler environment deliberately has no AI
binding, so preview needs no Cloudflare login and the endpoint returns the
deterministic fallback response — this is the primary zero-account local check.
Point the smoke script at whichever port wrangler prints:

```sh
node scripts/smoke.mjs http://localhost:8787/
```

## Cloudflare Workers AI

Workers AI does not need placeholder IDs in `wrangler.toml`. The real binding
lives in the named `ai` Wrangler environment:

```toml
[env.ai.ai]
binding = "AI"
```

For real model responses, authenticate Wrangler with a Cloudflare account that
can use Workers AI:

```sh
pnpm exec wrangler login
```

Then run the binding-realistic loop:

```sh
pnpm dev:cf
```

`dev:cf` runs `pnpm build`, starts `wrangler dev --env ai --port 8788`, and
watches the source files with `chokidar-cli`, rebuilding when pages,
components, `lib`, or styles change.

Endpoint check after `pnpm build` and `wrangler dev`:

```sh
curl -X POST http://localhost:8788/api/summarize \
  -H "content-type: application/json" \
  -d '{"text":"zfb renders static pages by default and uses prerender = false for request-time routes."}'
```

If Wrangler is not authenticated or Workers AI is unavailable, the endpoint
still returns JSON with `"fallback": true`.

## Deploy

```sh
pnpm build
pnpm exec wrangler deploy --env ai
```

Production URL: **<https://zfb-example-ai-summarizer.takazudomodular.com>**

The `--env ai` part matters. The `AI` binding lives in the named `ai` Wrangler
environment, so that environment is what gets deployed — and it renames the
Worker to `zfb-example-ai-summarizer-ai`. The custom domain is therefore
attached to the `ai` environment too:

```toml
[[env.ai.routes]]
pattern = "zfb-example-ai-summarizer.takazudomodular.com"
custom_domain = true
```

A top-level `[[routes]]` would bind the domain to the `zfb-example-ai-summarizer`
Worker, which is never deployed. The site also stays reachable on
`zfb-example-ai-summarizer-ai.takazudo.workers.dev` (`workers_dev = true`).

## Continuous deployment (GitHub Actions)

Setting this up from zero? Follow
[docs/cloudflare-setup.md](docs/cloudflare-setup.md) — the ordered token →
secrets → first deploy → verify walkthrough.

This repo ships `.github/workflows/deploy.yml`:

- **build** runs on every push and PR — `pnpm install`, `pnpm typecheck`,
  `pnpm build`. It needs no Cloudflare credentials, so CI is green immediately.
- **deploy** runs on push to `main` and calls `wrangler deploy`. It self-skips
  until the secrets below are set, so a fresh repo never shows a red deploy.

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Account · Workers Scripts: Edit, Workers AI: Read, Account Settings: Read, and Zone · Workers Routes: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | target Cloudflare account id |

The deploy job runs `wrangler deploy --env ai` (the `AI` binding lives in the named `ai` Wrangler environment). There are no placeholder ids to fill in.

### Post-deploy smoke test

After a real deploy, CI runs `scripts/smoke.mjs` against the live custom domain.
It checks that the homepage answers 200 over valid TLS with this site's markup,
and that `POST /api/summarize` returns a well-formed response — accepting either
a live Workers AI summary or the deterministic fallback, since demanding live AI
output would make the check flaky by construction.

Run it by hand against any deployment:

```sh
node scripts/smoke.mjs                                                   # the custom domain
node scripts/smoke.mjs https://zfb-example-ai-summarizer-ai.takazudo.workers.dev
```

While the custom domain does not resolve yet, the script exits 0 with a
`::notice::` rather than failing — the same never-red-before-Cloudflare-is-wired
rule the deploy job's preflight step follows.

### Cloudflare API token permissions

The `CLOUDFLARE_API_TOKEN` repo secret is an **Account**-scoped custom token
(Cloudflare dashboard → My Profile → API Tokens → Create Custom Token) with
these permissions:

- **Workers Scripts** — Edit
- **Workers AI** — Read
- **Account Settings** — Read

Set **Account Resources → Include → (your account)**.

It additionally needs one **Zone**-scoped permission, because this repo serves a
custom domain rather than only a `*.workers.dev` host:

- **Workers Routes** — Edit, on the `takazudomodular.com` zone

Creating the `custom_domain` route in `wrangler.toml` is a zone-scoped
operation, so a token carrying only the account permissions above deploys the
Worker fine and then fails on the route step. A single token can be shared
across all `zfb-example-*` repos if it carries the union of every repo's
permissions.
