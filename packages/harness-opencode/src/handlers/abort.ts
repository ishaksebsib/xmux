import type { HarnessAdapterAbortInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { toSessionResponseError, type OpenCodeCreateOptions } from "./utils";

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

    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        toSessionResponseError({
          status,
          detail: response.error,
          reason: "OpenCode session abort failed",
        }),
      );
    }

    if (response.data !== true) {
      return Result.err(
        toSessionResponseError({
          status,
          reason: "OpenCode session abort returned no success confirmation",
        }),
      );
    }

    return Result.ok(undefined);
  });
}
