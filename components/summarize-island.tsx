"use client";

import { computed, getScope, Show, signal } from "@takazudo/zfb/zudo-react";

type SummaryResponse = {
  summary: string;
  fallback: boolean;
  model?: string;
  reason?: string;
};

const SAMPLE_TEXT =
  "Zudo Front Builder renders static pages by default, then lets individual routes opt into request-time execution with prerender = false. On Cloudflare, the adapter emits a Worker entry and static assets in the same dist directory, so API routes can read bindings while the rest of the site stays cacheable.";

// zudo-react runs this setup once per island; signals keep the markup live.
export default function SummarizeIsland() {
  const scope = getScope();

  const text = signal(SAMPLE_TEXT);
  const result = signal<SummaryResponse | null>(null);
  const error = signal<string | null>(null);
  const isLoading = signal(false);

  const buttonLabel = computed(() => (isLoading.value ? "Summarizing..." : "Summarize"));
  const wordCount = computed(
    () => `${text.value.trim().split(/\s+/).filter(Boolean).length} words`,
  );
  const hasError = computed(() => error.value !== null);
  const errorText = computed(() => error.value ?? "");
  const hasResult = computed(() => result.value !== null);
  const summary = computed(() => result.value?.summary ?? "");
  const isFallback = computed(() => result.value?.fallback === true);
  const hasReason = computed(() => Boolean(result.value?.reason));
  const reason = computed(() => result.value?.reason ?? "");

  // Each submission gets a generation number; only the newest one may write
  // state, and nothing may write once the island is disposed.
  let generation = 0;

  async function handleSubmit(event: Event) {
    event.preventDefault();
    const input = text.value.trim();

    if (!input) {
      result.value = null;
      error.value = "Enter text to summarize.";
      return;
    }

    const current = ++generation;
    const isCurrent = () => current === generation && !scope.abortSignal.aborted;

    isLoading.value = true;
    error.value = null;
    result.value = { summary: "Summarizing...", fallback: false };

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input }),
        signal: scope.abortSignal,
      });
      const payload = (await response.json()) as Partial<SummaryResponse> & { error?: string };
      if (!isCurrent()) return;

      if (!response.ok) {
        result.value = null;
        error.value = payload.error ?? "The summarizer could not process that text.";
        return;
      }

      if (typeof payload.summary !== "string" || !payload.summary.trim()) {
        result.value = null;
        error.value = "The summarizer returned an empty response.";
        return;
      }

      result.value = {
        summary: payload.summary,
        fallback: Boolean(payload.fallback),
        model: payload.model,
        reason: payload.reason,
      };
    } catch {
      if (!isCurrent()) return;
      result.value = null;
      error.value = "The summarizer is unreachable.";
    } finally {
      if (isCurrent()) isLoading.value = false;
    }
  }

  return (
    <form class="summarizer" on:submit={handleSubmit}>
      <label class="field">
        <span>Source text</span>
        <textarea modelValue={text} rows={10} maxlength={6000} />
      </label>
      <div class="actions">
        <button type="submit" disabled={isLoading}>
          {buttonLabel}
        </button>
        <span class="count">{wordCount}</span>
      </div>
      <output class="result" aria-live="polite">
        <Show when={hasError}>{() => <p class="error">{errorText}</p>}</Show>
        <Show when={hasResult}>
          {() => (
            <section>
              <div class="result-header">
                <span>Summary</span>
                <Show when={isFallback}>{() => <span class="badge">Fallback</span>}</Show>
              </div>
              <pre>{summary}</pre>
              <Show when={hasReason}>{() => <p class="hint">Reason: {reason}</p>}</Show>
            </section>
          )}
        </Show>
      </output>
    </form>
  );
}
