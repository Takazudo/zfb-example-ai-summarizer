import { getCloudflareContext, type CloudflareContext } from "@takazudo/zfb-adapter-cloudflare";

import { summarizeText, type AiEnv, type SummaryResult } from "../../lib/ai";

export const prerender = false;

type ErrorBody = {
  error: string;
};

// zfb 2.x calls a `prerender = false` route's default export with the page's
// props — NOT with the incoming Request. The Request, the Worker `env`, and the
// ExecutionContext all arrive together on the adapter's per-request
// AsyncLocalStorage context instead. (Taking the Request as the first parameter
// was the pre-2.0 contract; a handler still written that way reads `.method`
// off a props object and answers every call with 405.)
export default async function SummarizeApi(): Promise<Response> {
  const context = readCloudflareContext();

  if (!context) {
    // No Cloudflare request scope: `zfb dev` serves pages from an SSG runtime
    // that has no Worker request at all, so the body can never be read there.
    // Use `pnpm preview` or `pnpm dev:cf`, which run this route under wrangler.
    return json<ErrorBody>(
      { error: "This route needs a Worker runtime. Run `pnpm preview` or `pnpm dev:cf`." },
      503,
    );
  }

  const { request, env } = context;

  if (request.method !== "POST") {
    return json<ErrorBody>({ error: "Use POST with a JSON body." }, 405);
  }

  const body = await readJson(request);
  const text = isRecord(body) && typeof body["text"] === "string" ? body["text"].trim() : "";

  if (!text) {
    return json<ErrorBody>({ error: "Enter text to summarize." }, 400);
  }

  const result = await summarizeText(text, env);
  return json<SummaryResult>(result);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readCloudflareContext(): CloudflareContext<AiEnv> | null {
  try {
    return getCloudflareContext<AiEnv>();
  } catch {
    return null;
  }
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
