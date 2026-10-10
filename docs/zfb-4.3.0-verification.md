# ZFB 4.3.0 verification

Baseline: main `81e6ce3368d7be30b904aa97860340eefd03cdf9`, exact SDK/runtime/adapter
3.1.0. Target: the three published packages at exact 4.3.0. Package integrity
values were re-read from npm and match `pnpm-lock.yaml`, including the new
transitive `@takazudo/zfb-slugify@4.3.0` and Linux x64 native carrier.
No overrides, backend switch, runtime patch or application behavior changes.

Release notes reviewed: 3.2.0, 4.0.0, 4.1.0, 4.2.0, 4.2.1 and 4.3.0. Relevant
changes include typed form defaults and cleanup, reserved import aliases,
scanner improvements, and deferred persisted-island scheduling. This app uses
`modelValue`, immediate hydration and authored CSS; no migration was required.
Published tarball surfaces for SDK/runtime/adapter were compared. The adapter's
external source-map comment removal does not change request-context behavior.
Registry metadata did not supply a `gitHead`; release tags/notes and published
tarballs were used rather than claiming a verified source commit for npm bytes.

## Commands and results

Linux x64, Node 24.19.0, Corepack pnpm 10.34.1, Playwright 1.61.1 / Chromium
149.0.7827.55. Local heavy runs used the installed machine-wide heavy guard.

- `corepack pnpm install --frozen-lockfile`: passed on baseline and target.
- `corepack pnpm typecheck`: passed on baseline and target.
- `bash "$HOME/.codex/scripts/heavy-guard.sh" -- corepack pnpm build`: passed
  on both versions; target reports `zfb 4.3.0`, embedded esbuild 0.25.12.
- `corepack pnpm exec zfb wind audit --plan build`: complete; no conflicts or
  dead classes. Authored class names and non-class-string `auditInfo` entries
  remain informational; no build diagnostics were suppressed.
- `node tests/runtime.mjs` and
  `TEST_DIST=/tmp/ai-summarizer-baseline-dist node tests/runtime.mjs`: passed,
  17 API cases per version plus methods, SSR, assets, private-bundle exclusion
  and authored 404. Both return 405 JSON for ordinary API GET and 404 HTML when raw HTTP
  preserves `sec-fetch-mode: navigate`.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/ai-summarizer-browsers
  BASELINE_DIST=/tmp/ai-summarizer-baseline-dist
  TEST_ARTIFACTS=/tmp/ai-summarizer-final
  bash "$HOME/.codex/scripts/heavy-guard.sh" -- corepack pnpm test:browser`:
  passed on both versions at 375/679/680/681/1280 px. All 26 screenshots matched
  byte-for-byte; computed styles and geometry matched. Loading, success,
  fallback, empty input without a request, HTTP/network/malformed/empty errors,
  retry, chunked JSON, out-of-order results, disposal and no-JS rendering passed.
  No unexpected console errors or page errors.
- `corepack pnpm preview --port 18927 --host 127.0.0.1`, then
  `node scripts/smoke.mjs http://127.0.0.1:18927/`: passed with deterministic
  `missing-ai-binding` fallback.

Initial harness failures were corrected, not hidden: mock echo accidentally
included the closing prompt delimiter; Node fetch rewrote the
navigation header to `cors`, so the test now uses raw HTTP and verifies the
original 404 contract on both versions. Two early
screenshot comparisons differed only at pending-output rounded-border pixels
(also varying between runs of the same version). Capturing layout/style metrics
before screenshots produced exact equality; no CSS changes or image tolerances
were introduced. The production stylesheet is byte-identical between builds.

## Scope and limitations

The test Worker config has no remote bindings, production routes or secrets.
All AI responses are local substitutes. Streaming coverage proves buffered JSON
consumption and fallback for an unexpected AI stream; this sample does not offer
an SSE/token-stream UI. No paid model request, live smoke, deployment, merge,
release or publication was performed.

Not run: WebKit/Safari, Firefox, macOS, Windows, ARM64, real IME and real Workers AI.
These are unverified, not implied by Linux Chromium or upstream pilot results.
No zudo-doc package or generated documentation exists here; existing documentation
paths and production Wrangler settings are preserved. Corporate and KV pilots
were not modified.

Existing repository issues/PRs and upstream
[ZFB #3879](https://github.com/Takazudo/zudo-front-builder/issues/3879) were checked.
No new reproducible upstream defect was established, so no duplicate bug was filed.
The draft PR records the final commit SHA and exact-head CI result. PR CI runs
the build and mock tests; deployment remains push-to-main only.
