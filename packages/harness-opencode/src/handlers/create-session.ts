import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import {
  toOpenCodeCreateModel,
  toResponseResult,
  toSessionInfo,
  toSessionModel,
  toSessionResponseError,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "./utils";

async function requestSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
) {
  const model = input.model ?? runtime.defaultModel;

  return Result.tryPromise({
    try: () =>
      runtime.client.session.create(
        {
          directory: input.cwd,
          parentID: input.adapterOptions.parentId,
          permission: input.adapterOptions.permission,
          title: input.title,
          workspace: input.adapterOptions.workspace,
          workspaceID: input.adapterOptions.workspaceId,
          model: toOpenCodeCreateModel(model),
        },
        { signal: input.signal },
      ),
    catch: (cause) => new OpenCodeSessionRequestError({ cause }),
  });
}

export async function createSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterCreateSessionResult<OpenCodeSessionInfo>,
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(requestSession(runtime, input));
    const session = yield* toResponseResult({
      response,
      toError: toSessionResponseError,
      failureReason: "OpenCode session create failed",
      missingReason: "OpenCode session create returned no session data",
    });

    const model = input.model ?? runtime.defaultModel ?? toSessionModel(session);
    if (model) {
      runtime.sessionModels.set(session.id, model);
    }

    return Result.ok({
      sessionId: session.id,
      model,
      adapterData: toSessionInfo(session),
    });
  });
}
