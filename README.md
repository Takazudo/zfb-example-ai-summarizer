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

`zfb dev` does not provide Cloudflare Worker bindings. This example keeps the
API route usable anyway: when the `AI` binding is missing, the route returns a
deterministic local fallback summary. That is the primary zero-account local
check.

Production build:

```sh
pnpm build
```

Preview:

```sh
pnpm preview
```

Because this project configures the Cloudflare adapter, `zfb preview` hands off
to `wrangler dev` after the build. The default Wrangler environment deliberately
has no AI binding, so preview works without a Cloudflare login and the endpoint
returns the deterministic fallback response.

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

## Continuous deployment (GitHub Actions)

This repo ships `.github/workflows/deploy.yml`:

- **build** runs on every push and PR — `pnpm install`, `pnpm typecheck`,
  `pnpm build`. It needs no Cloudflare credentials, so CI is green immediately.
- **deploy** runs on push to `main` and calls `wrangler deploy`. It self-skips
  until the secrets below are set, so a fresh repo never shows a red deploy.

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Account · Workers Scripts: Edit and Workers AI: Read |
| `CLOUDFLARE_ACCOUNT_ID` | target Cloudflare account id |

The deploy job runs `wrangler deploy --env ai` (the `AI` binding lives in the named `ai` Wrangler environment). There are no placeholder ids to fill in.
