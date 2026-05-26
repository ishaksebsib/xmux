import type { HarnessAdapterAbortInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { toResponseResult, toSessionResponseError, type OpenCodeCreateOptions } from "./utils";

export async function abortSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterAbortInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<void, OpenCodeSessionRequestError | OpenCodeSessionResponseError>> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.abort(
            {
              sessionID: input.ref.sessionId,
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeSessionRequestError({ cause }),
      }),
    );

    const aborted = yield* toResponseResult({
      response,
      toError: toSessionResponseError,
      failureReason: "OpenCode session abort failed",
      missingReason: "OpenCode session abort returned no success confirmation",
    });

    if (aborted !== true) {
      return Result.err(
        toSessionResponseError({
          status: response.response?.status ?? 0,
          reason: "OpenCode session abort returned no success confirmation",
        }),
      );
    }

    return Result.ok(undefined);
  });
}
