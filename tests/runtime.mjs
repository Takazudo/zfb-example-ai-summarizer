import assert from "node:assert/strict";
import { get } from "node:http";
import { startWorker } from "./local-worker.mjs";

const server = await startWorker({ dist: process.env.TEST_DIST });
let checks = 0;
const text = "ZFB renders static pages. Workers handle API requests. Local tests need no credentials.";
async function post(body, mode = "success") {
  const response = await fetch(`${server.url}/api/summarize`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-ai": mode }, body,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /application\/json/);
  checks++;
  return { status: response.status, body: await response.json() };
}
try {
  for (const body of ["{", "null", "[]", "{}", '{"text":42}', '{"text":"  "}']) {
    assert.deepEqual(await post(body), { status: 400, body: { error: "Enter text to summarize." } });
  }
  for (const mode of ["success", "string", "choices"]) {
    const result = await post(JSON.stringify({ text }), mode);
    assert.equal(result.status, 200);
    assert.equal(result.body.fallback, false);
    assert.match(result.body.summary, /Local mocked AI summary/);
  }
  for (const [mode, reason] of [["missing", "missing-ai-binding"], ["throw", "ai-run-failed"],
    ["empty", "empty-ai-output"], ["stream", "empty-ai-output"]]) {
    const result = await post(JSON.stringify({ text }), mode);
    assert.equal(result.status, 200);
    assert.equal(result.body.fallback, true);
    assert.equal(result.body.reason, reason);
    assert.match(result.body.summary, /ZFB renders static pages/);
  }
  const long = await post(JSON.stringify({ text: "x".repeat(6500) }), "echo");
  assert.equal(long.body.summary.length, 6000);
  const normalized = await post(JSON.stringify({ text: "  one\n two\t three four  " }), "echo");
  assert.equal(normalized.body.summary, "one two three four");
  const concurrent = await Promise.all([post(JSON.stringify({ text }), "throw"), post(JSON.stringify({ text }), "success")]);
  assert.equal(concurrent[0].body.reason, "ai-run-failed");
  assert.equal(concurrent[1].body.fallback, false);
  const getResponse = await fetch(`${server.url}/api/summarize`);
  assert.equal(getResponse.status, 405);
  assert.deepEqual(await getResponse.json(), { error: "Use POST with a JSON body." });
  // Node fetch overwrites sec-fetch-mode; raw HTTP preserves the navigation probe.
  const navigate = await new Promise((resolve, reject) => {
    get(`${server.url}/api/summarize`, { headers: { "sec-fetch-mode": "navigate" } }, response => {
      response.resume();
      resolve({ status: response.statusCode, type: response.headers["content-type"] });
    }).on("error", reject);
  });
  assert.equal(navigate.status, 404);
  assert.match(navigate.type, /text\/html/);
  const missing = await fetch(`${server.url}/not-found`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /404/);
  const home = await fetch(server.url);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /AI Summarizer/);
  for (const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1])) {
    assert.equal((await fetch(server.url + asset)).status, 200);
  }
  for (const path of ["/_worker.js", "/_zfb_inner.mjs"]) {
    assert.equal((await fetch(server.url + path)).status, 404);
  }
  console.log(`PASS: ${checks} API cases; method/navigation/404, SSR, assets and private bundles (local workerd).`);
} finally {
  await server.stop();
}
