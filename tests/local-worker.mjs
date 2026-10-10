import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { unstable_dev } from "wrangler";

export async function startWorker({ mock = true, dist = resolve("dist") } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "ai-summarizer-test-"));
  const config = resolve(directory, "wrangler.json");
  let main = resolve(dist, "_worker.js");
  if (mock) {
    const source = await readFile(new URL("./mock-worker.mjs", import.meta.url), "utf8");
    const entry = resolve(directory, "mock-worker.mjs");
    await writeFile(entry, source.replace('"../dist/_worker.js"', JSON.stringify(main)));
    main = entry;
  }
  await writeFile(config, JSON.stringify({
    name: "ai-summarizer-local-test", main,
    compatibility_date: "2026-05-01", compatibility_flags: ["nodejs_compat"],
    assets: { directory: dist, binding: "ASSETS", not_found_handling: "404-page", run_worker_first: false },
  }));
  try {
    const server = await unstable_dev(main, {
      config, local: true, ip: "127.0.0.1", port: 0, inspectorPort: 0,
      persist: false, envFiles: [], logLevel: "error",
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
    return {
      url: `http://127.0.0.1:${server.port}`,
      async stop() { await server.stop(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
