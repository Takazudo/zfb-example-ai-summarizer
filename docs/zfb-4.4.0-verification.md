# ZFB 4.4.0 verification

Verified on 2026-10-13, Linux x64, Node 24.19.0, pnpm 10.34.1,
Playwright 1.61.1 and system Chromium 154.0.8037.57.

Default branch: main `81e6ce3368d7be30b904aa97860340eefd03cdf9`, all three
registry dependencies at exact 3.1.0. Reused draft PR #24 at
`9298cb4413ee277e33bc0c9b94f793ce8466d3c4` (exact 4.3.0), preserving its
implementation and tests. This follow-up moves SDK, runtime and Cloudflare
adapter together from 4.3.0 to exact 4.4.0. The lockfile changes only the ZFB
family, including slugify and platform carriers. No application or CSS changes.

The current dev-bump-zudo-deps resolver from claude-settings commit
`4d8315a0ead56dac135ee7d576791371333ca101` scanned the sole package.json.
Final resolution: three up-to-date, no tag-tracked/skipped/error rows and no
prerelease graduation decision. No ZUDO_DEPS_PINS.md or vendored Zudo artifacts
exist; generated build output remains ignored.

## Published changes require no consumer migration

The previous 3.1.0-to-4.3.0 assessment remains in
[zfb-4.3.0-verification.md](zfb-4.3.0-verification.md). All subsequent release
notes were read:

- 4.3.1: router History-write rejection recovery; no router enabled in this demo.
- 4.3.2: MDX ignored-attribute scanning correction; this demo has TSX pages.
- 4.3.3: YAML parser update and budget enforcement; no frontmatter here.
- 4.4.0: YAML parsing performance/tag semantics and fragment Back/Forward fixes;
  no affected consumer API use.

Published tarball comparisons used the actual PR lockfile version 4.3.0:
`npm diff --diff=@takazudo/<package>@4.3.0 --diff=@takazudo/<package>@4.4.0`.
SDK and adapter differ only in package metadata; SDK updates slugify/native
carriers. Runtime changes its router implementation and declarations, with no
island changes. Slugify differs only in metadata; Linux x64 carrier changes its
binary. Runtime's exact SDK peer is 4.4.0 and is satisfied. Exports and engine
requirements do not change. No patched packages or unreleased checkouts used.

Registry gitHead was absent. Verified remote tags are
v4.3.0 `689dfbfcfe4154aaccffe74d14bb5aadfef3ec6a` and
v4.4.0 `29377d1c0bfd607dea6d654557e46ff7bf536b2e`; these identify source releases,
not a claim that npm bytes exactly equal a git tree. Published diffs and release
notes provided sufficient context without a repository-source diff.

## Validation passes with exact visual parity

Environment cache locations were moved to /tmp using COREPACK_HOME and XDG
variables; HOME and CODEX_HOME were not changed. Heavy runs used the installed
portable heavy-guard.sh with its default shared lock, via sandbox escalation.

- `corepack pnpm install --frozen-lockfile`, `corepack pnpm typecheck` and guarded
  `corepack pnpm build`: passed for 3.1.0 main, existing 4.3.0 PR and 4.4.0 target.
- Guarded `corepack pnpm test:runtime`: 17 API cases, methods/navigation/404,
  SSR/assets and private-bundle exclusions pass. Repeated with TEST_DIST pointing
  to each old build.
- Guarded `corepack pnpm test:browser` with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`,
  `BASELINE_DIST=/workspace/scratch/ai-summarizer-main/dist`, and
  `TEST_ARTIFACTS=/tmp/ai-summarizer-main-stable-parity`: both versions pass all
  interactions; all 26 screenshots and computed styles/geometry match exactly
  at 375/679/680/681/1280 pixels. Covers idle/focus/pending/fallback/error/404,
  retry, HTTP/network/malformed/empty responses, chunked JSON, stale responses,
  disposal and no-JS rendering.
- `corepack pnpm preview --port 18927 --host 127.0.0.1` and
  `node scripts/smoke.mjs http://127.0.0.1:18927/`: passed, missing-ai-binding
  deterministic fallback. No live smoke or real model invocation.
- `corepack pnpm exec wrangler deploy --dry-run --env ai --outdir /tmp/ai-summarizer-ai-dry-run`:
  passed, 154.08 KiB upload / 36.93 KiB gzip; exited without uploading.
- `corepack pnpm exec zfb wind audit --plan build`: complete, no conflicts/dead
  classes. Authored classes and non-class-string auditInfo remain informational.
- `git diff --check`: passed.

Initial single-capture parity failed on 13–26 rounded-border pixels while all
styles/geometry matched. An identical 4.4.0-versus-4.4.0 control reproduced the
same failure. Scroll normalization and disabling GPU did not fix it and were
removed. The harness now requires two consecutive byte-identical captures
(maximum five comparisons) before comparing versions. Strict equality remains;
no tolerances, masks or skipped states. Artifacts are saved before assertions,
and failures identify a specific state instead of dumping all computed styles.

The pinned browser download returned HTTP 403 even after escalation. The
optional executable path enables the preinstalled browser; CI continues using
its pinned Playwright Chromium. Initial cache/log writes outside the sandbox
failed; explicit cache directories and guarded escalation resolved them.
These were environment/harness failures, not reproducible ZFB defects.

Not verified: real Workers AI, WebKit/Firefox, macOS/Windows/ARM64, real IME.
No deployment, merge, package publication or infrastructure changes were made.
