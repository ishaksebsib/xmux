import { stat } from "node:fs/promises";
import type { Session } from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterListSessionsInput,
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

async function toListedSession(
  session: Session,
): Promise<HarnessAdapterSessionInfo<OpenCodeSessionInfo>> {
  const adapterSession = toAdapterSession(session);
  const cwd = await Result.tryPromise({
    try: async () => {
      const stats = await stat(session.directory);
      return stats.isDirectory() ? session.directory : undefined;
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

    return Result.ok(await Promise.all(response.data.map(toListedSession)));
  });
}
