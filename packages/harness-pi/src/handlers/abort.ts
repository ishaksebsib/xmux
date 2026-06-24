import { HarnessSessionNotFoundError, type HarnessAdapterAbortInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiSessionNotFoundError, PiSessionRequestError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";

export async function abortSession(
  runtime: PiRuntime,
  input: HarnessAdapterAbortInput<"pi", PiCreateOptions>,
): Promise<ResultType<void, HarnessSessionNotFoundError | PiSessionRequestError>> {
  const handle = runtime.sessions.get(input.ref.sessionId);
  if (!handle) {
    return Result.err(
      new HarnessSessionNotFoundError({
        ref: input.ref,
        operation: "abort",
        cause: new PiSessionNotFoundError({ sessionId: input.ref.sessionId }),
      }),
    );
  }

  return Result.tryPromise({
    try: () => handle.session.abort(),
    catch: (cause) => new PiSessionRequestError({ operation: "abort", cause }),
  });
}
