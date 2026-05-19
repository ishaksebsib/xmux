import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import {
  toSessionInfo,
  toSessionResponseError,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "./utils";

async function requestSession(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterCreateSessionInput<OpenCodeCreateOptions>,
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
    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        toSessionResponseError({
          status,
          detail: response.error,
          reason: "OpenCode session create failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        toSessionResponseError({
          status,
          reason: "OpenCode session create returned no session data",
        }),
      );
    }

    return Result.ok({
      sessionId: response.data.id,
      adapterData: toSessionInfo(response.data),
    });
  });
}
