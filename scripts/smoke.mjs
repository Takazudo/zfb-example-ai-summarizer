#!/usr/bin/env node
// Post-deploy smoke test against the LIVE site.
//
// A deploy can succeed while the site is still unreachable: the custom-domain
// route is a separate Cloudflare resource from the Worker script, so
// `wrangler deploy` can upload a perfectly good Worker and still leave
// zfb-example-ai-summarizer.takazudomodular.com pointing at nothing. Only a
// real request over the real hostname can tell the two apart, which is why this
// runs after deploy instead of being a unit test.
//
// Usage:
//   node scripts/smoke.mjs [url]
//   SMOKE_URL=https://zfb-example-ai-summarizer-ai.takazudo.workers.dev node scripts/smoke.mjs
//   SMOKE_REQUIRE_LIVE=1 node scripts/smoke.mjs   # no skipping, the site must be up
//
// Exit codes:
//   0  all checks passed, OR the domain is not wired up yet (deliberate skip)
//   1  the site answered but a check failed, or SMOKE_REQUIRE_LIVE is set and
//      the domain is not serving
//
// The skip path exists because this repo family's house rule is that a repo
// never shows a red deploy before Cloudflare is configured — the same reason
// deploy.yml has a "Preflight — is Cloudflare configured?" step. It is a
// one-way ramp: once the domain is actually serving, that grace period is over
// and SMOKE_REQUIRE_LIVE retires it, so an outage can no longer exit 0 through
// a path meant for a domain that was never set up.

const DEFAULT_URL = "https://zfb-example-ai-summarizer.takazudomodular.com/";
const BASE_URL = process.argv[2] ?? process.env.SMOKE_URL ?? DEFAULT_URL;

// Set by deploy.yml, where the custom domain is known to be attached and
// serving. Every condition that would otherwise skip becomes a hard failure:
// "not wired up yet" is only a truthful description of a domain nobody has
// configured, and once one has been, the same symptoms mean an outage.
const REQUIRE_LIVE = /^(1|true|yes|on)$/i.test((process.env.SMOKE_REQUIRE_LIVE ?? "").trim());

const PAGE_TIMEOUT_MS = 20_000;
// The summarize route may invoke Workers AI, which is slower than a static hit.
const API_TIMEOUT_MS = 45_000;
// A freshly attached custom domain can need a moment for DNS/TLS to propagate.
const CONNECT_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

// Verified present in dist/index.html after `pnpm build`. Both are ASCII so the
// assertion cannot fail on a charset technicality — the real <title> also
// contains a "·", which is deliberately left out of the match.
const HTML_MARKERS = ["<title>AI Summarizer", "<h1>AI Summarizer</h1>"];

const SAMPLE_TEXT =
  "zfb renders static pages by default and uses prerender = false for request-time routes.";

// Connection-level failures that mean "the domain is not wired up yet" rather
// than "the site is broken": no DNS record, nothing listening, or a certificate
// that does not yet cover this hostname.
const NOT_WIRED_UP_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  // The host published AAAA records but the client has no IPv6 route. GitHub
  // runners have no IPv6, so during the propagation window — when Cloudflare
  // has published AAAA but not yet A — every connect fails this way.
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

// CERT_HAS_EXPIRED is deliberately NOT above. A freshly issued edge certificate
// is never expired, so an expiry can only mean an already-provisioned domain
// broke — exactly the outage this check exists to catch. Skipping on it would
// exit 0 through a real TLS failure.

// Cloudflare edge statuses for "the hostname resolves to Cloudflare, but no
// Worker is attached / the origin is unreachable" — still the not-wired-up
// state, not a broken build. https://developers.cloudflare.com/support/troubleshooting/
const NOT_WIRED_UP_STATUSES = new Set([521, 522, 523, 525, 526, 530]);

class SkipSignal extends Error {}

// Flips true the moment any request comes back from the host. After that the
// site is demonstrably wired up, so a later connection error is a real fault
// and must NOT be reclassified as "not deployed yet".
let siteAnswered = false;

function log(message) {
  console.log(message);
}

function notice(message) {
  // GitHub Actions renders ::notice:: in the run summary; harmless locally.
  console.log(`::notice::${message}`);
}

function isNotWiredUp(error) {
  for (let cause = error; cause; cause = cause.cause) {
    if (typeof cause.code === "string") {
      if (NOT_WIRED_UP_CODES.has(cause.code)) return cause.code;
      if (cause.code.startsWith("ERR_TLS")) return cause.code;
    }
    // Happy-Eyeballs failures arrive as an AggregateError whose per-address
    // errors carry the real code; the aggregate itself may not.
    if (Array.isArray(cause.errors)) {
      for (const inner of cause.errors) {
        const code = isNotWiredUp(inner);
        if (code) return code;
      }
    }
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, { timeoutMs, ...init } = {}) {
  let lastCode = null;

  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      siteAnswered = true;
      return res;
    } catch (error) {
      // Our own AbortSignal.timeout surfaces as a TimeoutError/AbortError
      // DOMException, not as a socket error code.
      const aborted = error?.name === "TimeoutError" || error?.name === "AbortError";
      const code = aborted ? "ETIMEDOUT" : isNotWiredUp(error);
      if (!code) throw error;

      lastCode = code;
      if (attempt < CONNECT_RETRIES) {
        log(`  … ${code} on attempt ${attempt}/${CONNECT_RETRIES}, retrying in ${RETRY_DELAY_MS / 1000}s`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const host = new URL(url).host;

  // The host already answered earlier in this run, so it is deployed and this
  // is a genuine fault — fail rather than skip.
  if (siteAnswered) {
    throw new Error(`${host} stopped responding (${lastCode} after ${CONNECT_RETRIES} attempts) at ${url}`);
  }

  throw new SkipSignal(`${host} is not reachable yet (${lastCode} after ${CONNECT_RETRIES} attempts)`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL ${message}`);
    process.exitCode = 1;
    return false;
  }
  log(`  ok   ${message}`);
  return true;
}

async function checkHomepage() {
  log(`Checking ${BASE_URL}`);
  const res = await request(BASE_URL, { timeoutMs: PAGE_TIMEOUT_MS, redirect: "follow" });

  if (NOT_WIRED_UP_STATUSES.has(res.status)) {
    // A SkipSignal, not a direct exit — under SMOKE_REQUIRE_LIVE main() turns
    // every one of these into a failure, so both skip paths share one gate.
    throw new SkipSignal(
      `${new URL(BASE_URL).host} returned HTTP ${res.status} — the hostname reaches Cloudflare but no Worker is attached`,
    );
  }

  // Reaching here over https means TLS completed for this hostname, so a valid
  // certificate covering it is implied — an invalid one throws at the
  // connection layer above and is caught as a not-wired-up skip.
  const scheme = new URL(BASE_URL).protocol === "https:" ? "over valid TLS" : "over http";
  if (!assert(res.status === 200, `homepage responds 200 ${scheme} (got ${res.status})`)) {
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";
  assert(contentType.includes("text/html"), `homepage is HTML (content-type: ${contentType || "none"})`);

  const html = await res.text();
  for (const marker of HTML_MARKERS) {
    assert(html.includes(marker), `homepage contains ${JSON.stringify(marker)}`);
  }
}

async function checkSummarize() {
  const url = new URL("/api/summarize", BASE_URL).toString();
  log(`Checking ${url}`);

  const res = await request(url, {
    timeoutMs: API_TIMEOUT_MS,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: SAMPLE_TEXT }),
  });

  // fetch downgrades POST to GET when it follows a 301/302, which would surface
  // here as a bare 405 with no hint as to why. Name it instead.
  if (res.redirected) {
    log(`  note request was redirected to ${res.url} — a 3xx turns POST into GET`);
  }

  if (!assert(res.status === 200, `summarize responds 200 (got ${res.status})`)) {
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    assert(false, "summarize returns parseable JSON");
    return;
  }

  // Assert the response SHAPE, not the content. lib/ai.ts falls back to a
  // deterministic local summary whenever the AI binding is missing or the model
  // call fails, so demanding fallback === false would make this test flaky by
  // construction. Either branch is a correctly working endpoint.
  assert(
    typeof data?.summary === "string" && data.summary.trim().length > 0,
    "summarize returns a non-empty summary string",
  );
  assert(typeof data?.fallback === "boolean", "summarize returns a boolean fallback flag");
  assert(
    typeof data?.model === "string" && data.model.length > 0,
    "summarize returns a model id string",
  );

  if (data?.fallback === true) {
    log(`  note deterministic fallback served (reason: ${data.reason ?? "unspecified"})`);
  } else if (data?.fallback === false) {
    log(`  note live Workers AI summary served by ${data.model}`);
  }
}

function describeFailure(error) {
  const seen = [];
  for (let cause = error; cause; cause = cause.cause) {
    if (typeof cause.code === "string") seen.push(cause.code);
    if (Array.isArray(cause.errors)) {
      for (const inner of cause.errors) {
        if (typeof inner?.code === "string") seen.push(inner.code);
      }
    }
  }
  const codes = [...new Set(seen)];
  return codes.length ? `${codes.join(", ")} (${error?.message ?? error})` : String(error?.message ?? error);
}

async function main() {
  if (REQUIRE_LIVE) {
    log("SMOKE_REQUIRE_LIVE is set — an unreachable site fails instead of skipping.");
  }

  try {
    await checkHomepage();
    await checkSummarize();
  } catch (error) {
    // Only skip when nothing has actually failed. Forcing exit 0 on top of a
    // recorded failure would hide a real regression behind the skip path.
    if (error instanceof SkipSignal && process.exitCode !== 1) {
      if (REQUIRE_LIVE) {
        console.error(
          `\nSmoke test FAILED — ${error.message}. SMOKE_REQUIRE_LIVE is set, so this is an outage on a domain that was already serving, not a deployment waiting to be configured.`,
        );
        process.exit(1);
      }
      notice(`Smoke test skipped — ${error.message}. Attach the custom domain, then re-run the deploy.`);
      process.exit(0);
    }

    // Anything else is a genuine transport/TLS fault on a domain that is not in
    // a recognised provisioning state — an expired certificate, for instance.
    // Report it legibly instead of letting an undici stack trace be the whole
    // CI output, since this is the path a real outage takes.
    const detail = describeFailure(error);
    console.error(`\nSmoke test FAILED — ${new URL(BASE_URL).host}: ${detail}`);
    process.exit(1);
  }

  if (process.exitCode === 1) {
    console.error("\nSmoke test FAILED — the site is reachable but did not behave correctly.");
    return;
  }

  log("\nSmoke test passed.");
}

await main();
