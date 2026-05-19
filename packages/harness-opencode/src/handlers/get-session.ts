import type { HarnessAdapterGetSessionInput, HarnessAdapterSessionInfo } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import {
  toAdapterSession,
  toSessionResponseError,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "./utils";

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

    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        toSessionResponseError({
          status,
          detail: response.error,
          reason: "OpenCode session get failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        toSessionResponseError({
          status,
          reason: "OpenCode session get returned no session data",
        }),
      );
    }

    return Result.ok(toAdapterSession(response.data));
  });
}
