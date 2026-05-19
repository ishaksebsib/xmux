import type {
  HarnessAdapterResumeSessionInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import {
  toAdapterSession,
  toSessionResponseError,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "./utils";

export async function resumeSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterResumeSessionInput<OpenCodeCreateOptions>,
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
              sessionID: input.sessionId,
              directory: input.cwd,
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
          reason: "OpenCode session resume failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        toSessionResponseError({
          status,
          reason: "OpenCode session resume returned no session data",
        }),
      );
    }

    return Result.ok(toAdapterSession(response.data));
  });
}
