import { Result } from "better-result";

export function mergeHeaders(baseHeaders: Headers, overrideHeaders?: Readonly<Record<string, string>>): Headers {
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(overrideHeaders ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

export function createRequestSignal(input: {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): { readonly signal?: AbortSignal; readonly cleanup: () => void } {
  if (!input.timeoutMs) return { signal: input.signal, cleanup: () => undefined };

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason);
  const timeout = setTimeout(
    () => controller.abort(new Error("Speech-to-text request timed out")),
    input.timeoutMs,
  );

  if (input.signal?.aborted) abortFromParent();
  else input.signal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function readResponseText(response: Response): Promise<string | undefined> {
  const text = await Result.tryPromise({
    try: () => response.text(),
    catch: () => undefined,
  });

  return text.isOk() && text.value.length > 0 ? text.value : undefined;
}
