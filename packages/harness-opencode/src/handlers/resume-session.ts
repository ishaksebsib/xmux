import type {
  HarnessAdapterResumeSessionInput,
  HarnessAdapterSessionInfo,
  HarnessSessionNotFoundError,
  SessionRef,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions, OpenCodeSessionInfo } from "../types";
import { getEffectiveSessionModel } from "./models";
import {
  mapOpenCodeSessionError,
  toAdapterSession,
  toResponseResult,
  toSessionResponseError,
} from "./utils";

export async function resumeSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterResumeSessionInput<OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterSessionInfo<OpenCodeSessionInfo>,
    OpenCodeSessionRequestError | OpenCodeSessionResponseError | HarnessSessionNotFoundError
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

    const ref: SessionRef<"opencode"> = { harnessId: "opencode", sessionId: input.sessionId };
    const session = yield* Result.mapError(
      toResponseResult({
        response,
        toError: toSessionResponseError,
        failureReason: "OpenCode session resume failed",
        missingReason: "OpenCode session resume returned no session data",
      }),
      (error) => mapOpenCodeSessionError({ error, ref, operation: "resumeSession" }),
    );

    const model = getEffectiveSessionModel({ runtime, session });
    if (model) {
      runtime.sessionModels.set(session.id, model);
    }

    const thinking = runtime.sessionThinking?.get(session.id) ?? runtime.defaultThinking;
    if (thinking) {
      runtime.sessionThinking?.set(session.id, thinking);
    }

    return Result.ok(
      toAdapterSession({
        session,
        model,
      }),
    );
  });
}
