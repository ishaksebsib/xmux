import type { HarnessAdapterAbortInput, HarnessSessionNotFoundError } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions } from "../types";
import {
  expectTrueResponse,
  mapOpenCodeSessionError,
  toResponseResult,
  toSessionResponseError,
} from "./utils";

export async function abortSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterAbortInput<"opencode", OpenCodeCreateOptions>,
): Promise<
  ResultType<
    void,
    OpenCodeSessionRequestError | OpenCodeSessionResponseError | HarnessSessionNotFoundError
  >
> {
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

    const aborted = yield* Result.mapError(
      toResponseResult({
        response,
        toError: toSessionResponseError,
        failureReason: "OpenCode session abort failed",
        missingReason: "OpenCode session abort returned no success confirmation",
      }),
      (error) => mapOpenCodeSessionError({ error, ref: input.ref, operation: "abort" }),
    );

    return Result.mapError(
      expectTrueResponse({
        value: aborted,
        status: response.response?.status ?? 0,
        reason: "OpenCode session abort returned no success confirmation",
        toError: toSessionResponseError,
      }),
      (error) => mapOpenCodeSessionError({ error, ref: input.ref, operation: "abort" }),
    );
  });
}
