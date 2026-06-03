import type { HarnessAdapterGetSessionInput, HarnessAdapterSessionInfo } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions, OpenCodeSessionInfo } from "../types";
import { getEffectiveSessionModel } from "./models";
import { toAdapterSession, toResponseResult, toSessionResponseError } from "./utils";

export async function getSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterGetSessionInput<"opencode", OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterSessionInfo<OpenCodeSessionInfo>,
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.get(
            {
              sessionID: input.ref.sessionId,
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeSessionRequestError({ cause }),
      }),
    );

    const session = yield* toResponseResult({
      response,
      toError: toSessionResponseError,
      failureReason: "OpenCode session get failed",
      missingReason: "OpenCode session get returned no session data",
    });

    return Result.ok(
      toAdapterSession({
        session,
        model: getEffectiveSessionModel({ runtime, session }),
      }),
    );
  });
}
