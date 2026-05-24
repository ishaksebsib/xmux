import { stat } from "node:fs/promises";
import type { Session } from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterListSessionsInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeSessionRequestError, OpenCodeSessionResponseError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { getEffectiveModel } from "./models";
import {
  toAdapterSession,
  toSessionResponseError,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "./utils";

async function toListedSession(args: {
  readonly runtime: OpenCodeRuntime;
  readonly session: Session;
}): Promise<HarnessAdapterSessionInfo<OpenCodeSessionInfo>> {
  const adapterSession = toAdapterSession({
    session: args.session,
    model: getEffectiveModel({
      runtime: args.runtime,
      target: {
        type: "session",
        ref: { harnessId: "opencode", sessionId: args.session.id },
      },
    }).model,
  });
  const cwd = await Result.tryPromise({
    try: async () => {
      const stats = await stat(args.session.directory);
      return stats.isDirectory() ? args.session.directory : undefined;
    },
    catch: () => undefined,
  });

  return {
    ...adapterSession,
    cwd: cwd.isOk() ? cwd.value : undefined,
  };
}

export async function listSessions(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterListSessionsInput<OpenCodeCreateOptions>,
): Promise<
  ResultType<
    readonly HarnessAdapterSessionInfo<OpenCodeSessionInfo>[],
    OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.session.list(
            {
              workspace: input.adapterOptions.workspace,
              directory: input.cwd,
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
          reason: "OpenCode session list failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        toSessionResponseError({
          status,
          reason: "OpenCode session list returned no data",
        }),
      );
    }

    return Result.ok(
      await Promise.all(response.data.map((session) => toListedSession({ runtime, session }))),
    );
  });
}
