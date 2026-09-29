---
name: l-handle-zfb-update
description: >-
  Update the zfb upstream dependency (the @takazudo/zfb* packages) in this
  example (ai-summarizer) to the latest stable release ("latest" dist-tag),
  review what changed upstream between versions, and adapt this project's code
  if a change touches a surface it uses. Use when: (1) User says 'update zfb',
  'bump zfb', 'zfb update', or 'handle zfb update', (2) A new zfb release is out
  and this example should track it.
user-invocable: true
argument-hint: "[target-version, e.g. 3.0.1 — omit to use latest stable]"
---

# Handle zfb Update — ai-summarizer

This example (on zfb 3.0.0 or newer) pairs a zudo-react island UI with a `pages/api/summarize.tsx` Worker
route backed by a Cloudflare Workers AI binding, and returns a deterministic
local fallback when the `AI` binding is absent.

Bump every `@takazudo/*` package this repo depends on to the latest stable
release (kept in lockstep on one version), review what changed upstream, and
adapt this project only where an upstream change touches a surface it actually
uses.

Upstream repo: `Takazudo/zudo-front-builder` (monorepo; npm packages live under
`packages/`). Every release has a `v<version>` tag and GitHub release notes.

## Step 0 — Preconditions

`package.json` and `pnpm-lock.yaml` must be clean (`git status --short` shows
neither). If either is dirty, stop and ask before touching them.

## Step 1 — Resolve current and target versions

```bash
CURRENT=$(node -p "require('./package.json').dependencies['@takazudo/zfb']")
TARGET=${1:-$(npm view @takazudo/zfb dist-tags.latest)}
```

- Always resolve the target from the `latest` dist-tag, never `next` — this repo
  tracks the zfb stable line. The `next` channel is dead: it ended at
  `1.1.0-next.1`, a prerelease of the already-released `1.1.0`, so the `next`
  dist-tag now points behind stable and resolving from it is a downgrade.
- If `CURRENT` == `TARGET`: report "already at the latest stable (<version>)" and STOP.
- If an explicit target is older than `CURRENT`, that is a downgrade — stop and
  confirm first.

## Step 2 — Review upstream changes BEFORE bumping

Enumerate versions between CURRENT (exclusive) and TARGET (inclusive) in publish
order — never sort prerelease strings lexically (`next.9` vs `next.10`):

```bash
node -e '
const vs = JSON.parse(process.argv[1]);
const cur = vs.indexOf(process.argv[2]), tgt = vs.indexOf(process.argv[3]);
if (tgt < 0) { console.error("target not found"); process.exit(1); }
if (cur >= 0 && tgt <= cur) { console.error("not newer than current"); process.exit(1); }
console.log(vs.slice(cur + 1, tgt + 1).join("\n"));
' "$(npm view @takazudo/zfb versions --json)" "$CURRENT" "$TARGET"
```

Read the release notes for EVERY enumerated version:

```bash
gh release view "v<version>" --repo Takazudo/zudo-front-builder --json body -q '.body'
```

If a release has no notes, fall back to the commit list:

```bash
gh api "repos/Takazudo/zudo-front-builder/compare/v<prev>...v<version>" \
  --jq '.commits[].commit.message' | head -40
```

**Fail closed:** if the changes cannot be reviewed at all, stop and ask — never
bump blind.

Flag anything that touches a surface this example uses:

| Upstream surface | Where this project uses it |
| --- | --- |
| `defineConfig` (`zfb/config` via `zfb-shim.d.ts`) | `zfb.config.ts` — `adapter: "@takazudo/zfb-adapter-cloudflare"`, `wind: { spec: 1, reset: "owned-v1" }` |
| Cloudflare adapter + `getCloudflareContext()` | emitted `dist/_worker.js`; the `AI` binding read in `pages/api/summarize.tsx` |
| API route contract (`export const prerender = false`) | `pages/api/summarize.tsx` |
| Islands runtime (`@takazudo/zfb-runtime`) + `<Island when="load">` | `components/summarize-island.tsx` hydration, `pages/index.tsx` |
| zudo-react (`signal`, `computed`, `Show`, `getScope().abortSignal`, `modelValue`, `on:submit`) | `components/summarize-island.tsx` |
| zudo-wind reset (`owned-v1`) + authored-class scanning | `styles/global.css` (plain authored CSS; one preflight-parity line on `button`) |
| JSX import source `@takazudo/zfb/zudo-react` | `tsconfig.json` |
| CLI (`zfb dev/build/preview/check`) | `package.json` scripts, `wrangler.toml` |

Rule: adapt only if this project actually uses the changed feature. Internal zfb
changes (Rust internals, docs, other frameworks) need no action — note and move on.

### Major-version bumps are migrations

A major bump (2.x → 3.0.0 was one) is not a two-line package edit: it changed the
JSX runtime, the CSS engine, and the config schema. Read the upstream migration
guide (`docs/.../guides/migrating-to-v3.mdx` style) and budget for the island port,
CSS parity, and the full verification in Step 5 including the browser checks.

## Step 3 — Bump every @takazudo/* package (lockstep)

```bash
PKGS=$(TARGET="$TARGET" node -p "Object.keys(require('./package.json').dependencies).filter(n=>n.startsWith('@takazudo/')).map(n=>n+'@'+process.env.TARGET).join(' ')")
pnpm add -E $PKGS
```

- `-E` keeps the exact pin (no caret) — this repo tracks one known-good zfb version.
- All `@takazudo/*` packages must land on the SAME version.
- Commit `package.json` AND `pnpm-lock.yaml` together — CI installs with
  `pnpm install --frozen-lockfile` and fails on a stale lockfile.
- pnpm is the package manager; npm is only for reading registry metadata.

## Step 4 — Adapt project code (only if Step 2 flagged something)

Apply what the flagged notes require (config schema, renamed APIs, adapter or
`ctx` changes, island markup, etc.). Update `README.md` if commands or documented
behavior changed. If nothing was flagged, skip.

## Step 5 — Verify

```bash
rm -rf ./dist ./.zfb ./.zfb-build
pnpm build       # pages build cleanly, adapter writes dist/_worker.js + dist/.assetsignore
pnpm typecheck   # zfb check passes
```

Run `pnpm typecheck` before `pnpm build`: `zfb check` names the file and suggests
HTML attribute spellings; the build's render errors do not.

For any bump that touches the island runtime, zudo-react, or the wind reset
(always for a major), also:

- start `pnpm preview --port <free-port> --host 127.0.0.1` (never assume 8787 is
  free) and run `node scripts/smoke.mjs http://127.0.0.1:<port>/` — expect
  "Smoke test passed." with the deterministic-fallback note; never point smoke at
  the live domain by hand;
- probe `POST /api/summarize` (valid → 200 fallback JSON with
  `cache-control: no-store`, empty/invalid → 400), `GET /api/summarize` (405 JSON;
  with `sec-fetch-mode: navigate` the asset layer answers the 404 page), and an
  unknown path (404 page);
- in a browser, after `[data-zfb-island="SummarizeIsland"][data-zfb-island-mounted]`,
  run the submit lifecycle: pending label + disabled button, fallback result with
  badge and reason, empty-input error, a mocked 500 / network failure, retry, and
  that the idle `.result:empty::before` placeholder still shows;
- compare screenshots against the previous version at 375 / 679 / 681 / 1280 px
  (the stylesheet breakpoint is 680px), serving both builds side by side.

`zfb build` / `zfb dev` do not provide the Workers `AI` binding, so the summarize
route returns its deterministic fallback locally — that is expected. For a
binding-realistic check, run `pnpm dev:cf` (or `pnpm exec wrangler dev --env ai`)
after building, per the README.

## Step 6 — Report

Summarize: versions traversed, notable upstream changes per release (one line
each), adaptations made (or "none needed"), and verification results.
