import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  OpenCodeModelSelectionError,
  OpenCodeSessionRequestError,
  OpenCodeSessionResponseError,
} from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions, OpenCodeSessionInfo } from "../types";
import {
  toOpenCodeCreateModel,
  toResponseResult,
  toSessionInfo,
  toSessionModel,
  toSessionResponseError,
} from "./utils";
import { applyThinkingToModel } from "./thinking";

async function requestSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
  model: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>["model"],
) {
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
    OpenCodeModelSelectionError | OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const thinking = input.thinking ?? runtime.defaultThinking;
    const selectedModel = yield* applyThinkingToModel({
      runtime,
      model: input.model ?? runtime.defaultModel,
      level: thinking,
    });
    const response = yield* Result.await(requestSession(runtime, input, selectedModel));
    const session = yield* toResponseResult({
      response,
      toError: toSessionResponseError,
      failureReason: "OpenCode session create failed",
      missingReason: "OpenCode session create returned no session data",
    });

    const model = selectedModel ?? toSessionModel(session);
    if (model) {
      runtime.sessionModels.set(session.id, model);
    }
    if (thinking) {
      runtime.sessionThinking.set(session.id, thinking);
    }

    return Result.ok({
      sessionId: session.id,
      model,
      adapterData: toSessionInfo(session),
    });
  });
}
