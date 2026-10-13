import worker from "../dist/_worker.js";

export default {
  async fetch(request, env, ctx) {
    const mode = request.headers.get("x-test-ai") ?? "success";
    const AI = {
      async run(model, options) {
        if (model !== "@cf/meta/llama-3.2-1b-instruct" || options.stream ||
            options.temperature !== 0 || options.max_tokens !== 220) {
          throw new Error("Unexpected AI invocation");
        }
        const text = options.messages[1].content.split("\n---\n")[1].replace(/\n---$/, "");
        if (mode === "throw") throw new Error("Mock AI unavailable");
        if (mode === "empty") return { response: "" };
        if (mode === "stream") {
          return new ReadableStream({ start(controller) { controller.close(); } });
        }
        if (mode === "echo") return { response: text };
        const response = "- Local mocked AI summary.\nTakeaway: No model request was sent.";
        if (mode === "string") return response;
        if (mode === "choices") return { choices: [{ message: { content: response } }] };
        return { response };
      },
    };
    return worker.fetch(request, { ...env, AI: mode === "missing" ? undefined : AI }, ctx);
  },
};
