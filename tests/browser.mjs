import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startWorker } from "./local-worker.mjs";

const artifacts = process.env.TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const results = {};
async function exercise(label, dist) {
  const server = await startWorker({ dist });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !/Failed to load resource|net::ERR_FAILED/.test(message.text())) errors.push(message.text());
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
  const mounted = () => page.waitForSelector('[data-zfb-island="SummarizeIsland"][data-zfb-island-mounted]');
  const ready = () => page.waitForFunction(() => !document.querySelector("button").disabled);
  const errorText = text => page.waitForFunction(expected => document.querySelector(".error")?.textContent === expected, text);
  async function snapshot(name) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.locator("form,textarea,button,output,section,pre").evaluateAll(elements =>
      elements.map(el => ({
        tag: el.tagName,
        rect: el.getBoundingClientRect().toJSON(),
        style: Object.fromEntries(Array.from(getComputedStyle(el)).map(key =>
          [key, getComputedStyle(el).getPropertyValue(key)])),
      })));
    const png = await page.screenshot({ fullPage: true, animations: "disabled" });
    results[label][name] = { sha256: createHash("sha256").update(png).digest("hex"), metrics };
    if (artifacts) await writeFile(resolve(artifacts, `${label}-${name}.png`), png);
  }
  results[label] = {};
  try {
    for (const width of [375, 679, 680, 681, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(server.url);
      await mounted();
      assert.equal(await page.locator("textarea").getAttribute("maxlength"), "6000");
      assert.equal(await page.locator("output").getAttribute("aria-live"), "polite");
      assert.equal(await page.locator("output").evaluate(el => getComputedStyle(el, "::before").content), '"Summary output"');
      await snapshot(`${width}-idle`);
      await page.locator("textarea").focus();
      await snapshot(`${width}-focus`);
      await page.locator("textarea").fill("One two three four.");
      await page.waitForFunction(() => document.querySelector(".count").textContent === "4 words");
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route("**/api/summarize", async route => {
        const response = await route.fetch({ headers: { ...route.request().headers(), "x-test-ai": "missing" } });
        await gate;
        await route.fulfill({ response });
      });
      await page.locator("button").click();
      assert.equal(await page.locator("button").isDisabled(), true);
      assert.equal(await page.locator("pre").textContent(), "Summarizing...");
      await snapshot(`${width}-pending`);
      release();
      await ready();
      assert.equal(await page.locator(".badge").textContent(), "Fallback");
      assert.match(await page.locator(".hint").textContent(), /missing-ai-binding/);
      await snapshot(`${width}-fallback`);
      await page.unroute("**/api/summarize");
      let calls = 0;
      const count = request => { if (request.url().endsWith("/api/summarize")) calls++; };
      page.on("request", count);
      await page.locator("textarea").fill("");
      await page.locator("button").click();
      await errorText("Enter text to summarize.");
      assert.equal(calls, 0);
      page.off("request", count);
      await snapshot(`${width}-error`);
    }
    await page.locator("textarea").fill("A sufficiently long source text for the local mocked model.");
    for (const [response, expected] of [
      [{ status: 500, contentType: "application/json", body: '{"error":"Mock failure"}' }, "Mock failure"],
      [{ status: 200, contentType: "application/json", body: '{"summary":""}' }, "The summarizer returned an empty response."],
      [{ status: 200, contentType: "application/json", body: '{' }, "The summarizer is unreachable."],
      [null, "The summarizer is unreachable."],
    ]) {
      await page.route("**/api/summarize", route => response ? route.fulfill(response) : route.abort("failed"));
      await page.locator("button").click();
      await errorText(expected);
      await ready();
      await page.unroute("**/api/summarize");
    }
    await page.locator("button").click();
    await page.waitForFunction(() => document.querySelector("pre")?.textContent.includes("Local mocked AI summary"));
    assert.equal(await page.locator(".badge").count(), 0);
    await ready();
    // A JSON response delivered in pieces must not expose a partial summary.
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"summary":"Chunked '));
        window.finishChunk = () => { controller.enqueue(new TextEncoder().encode('summary is complete.","fallback":false}')); controller.close(); window.fetch = original; };
      } }), { headers: { "content-type": "application/json" } });
    });
    await page.locator("button").click();
    assert.equal(await page.locator("pre").textContent(), "Summarizing...");
    assert.equal(await page.locator("button").isDisabled(), true);
    await page.evaluate(() => window.finishChunk());
    await ready();
    assert.equal(await page.locator("pre").textContent(), "Chunked summary is complete.");
    await page.evaluate(() => {
      window.pending = [];
      window.fetch = () => new Promise(resolve => window.pending.push(resolve));
      document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      window.pending[1](Response.json({ summary: "Newest response wins.", fallback: false }));
    });
    await ready();
    await page.evaluate(() => window.pending[0](Response.json({ summary: "Old response loses.", fallback: false })));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.locator("pre").textContent(), "Newest response wins.");
    await page.evaluate(() => {
      document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const island = document.querySelector("[data-zfb-island]");
      island[Symbol.for("@takazudo/zfb/zudo-react/root-v1")].unmount();
      window.pending[2](Response.json({ summary: "Disposed result ignored.", fallback: false }));
    });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await page.locator("form").count(), 0);
    await page.goto(`${server.url}/not-found`);
    await snapshot("404");
    assert.deepEqual(errors, []);
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    try {
      const ssr = await noJs.newPage();
      await ssr.goto(server.url);
      assert.match(await ssr.locator("textarea").inputValue(), /Zudo Front Builder/);
      assert.equal(await ssr.locator("button").textContent(), "Summarize");
    } finally { await noJs.close(); }
    console.log(`PASS ${label}: Chromium ${browser.version()}, 5 widths, 26 screenshots, lifecycle/errors/chunked JSON/stale results/disposal/no-JS.`);
  } finally { await context.close(); await server.stop(); }
}
try {
  if (process.env.BASELINE_DIST) await exercise("baseline", resolve(process.env.BASELINE_DIST));
  await exercise("target", resolve("dist"));
  if (results.baseline) {
    assert.deepEqual(results.target, results.baseline, "Screenshots must match the 3.1.0 baseline");
    console.log("PASS: all 26 screenshots byte-identical to 3.1.0.");
  }
  if (artifacts) await writeFile(resolve(artifacts, "screenshots.json"), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
