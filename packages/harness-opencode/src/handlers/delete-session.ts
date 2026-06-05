import type { HarnessAdapterDeleteSessionInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions } from "../types";
import { expectTrueResponse, toResponseResult, toSessionResponseError } from "./utils";

export async function deleteSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterDeleteSessionInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<void, OpenCodeSessionRequestError | OpenCodeSessionResponseError>> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.delete(
            {
              sessionID: input.ref.sessionId,
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeSessionRequestError({ cause }),
      }),
    );

    const deleted = yield* toResponseResult({
      response,
      toError: toSessionResponseError,
      failureReason: "OpenCode session delete failed",
      missingReason: "OpenCode session delete returned no success confirmation",
    });

    yield* expectTrueResponse({
      value: deleted,
      status: response.response?.status ?? 0,
      reason: "OpenCode session delete returned no success confirmation",
      toError: toSessionResponseError,
    });

    runtime.sessionModels.delete(input.ref.sessionId);
    runtime.sessionThinking?.delete(input.ref.sessionId);

    return Result.ok(undefined);
  });
}
