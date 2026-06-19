import { defineHarnessAdapter, type OpenedHarnessAdapter } from "@xmux/harness-core";
import { Result } from "better-result";
import {
  createOpenCodeLogScope,
  logHarnessResult,
  logOpenCodeOperation,
  openCodeLogEvents,
  startHarnessLogTimer,
  type OpenCodeLogScope,
} from "./logger";
import { parseOpenCodeAdapterConfig } from "./config";
import { openRuntime, type OpenCodeRuntime } from "./runtime";
import { abortSession } from "./handlers/abort";
import { createSession } from "./handlers/create-session";
import { deleteSession } from "./handlers/delete-session";
import { getSession } from "./handlers/get-session";
import { listSessions } from "./handlers/list-sessions";
import { getModel, listModels, setModel } from "./handlers/models";
import { prompt } from "./handlers/prompt";
import { getThinking, setThinking } from "./handlers/thinking";
import { resumeSession } from "./handlers/resume-session";
import { respondInteraction } from "./handlers/respond-interaction";
import type {
  OpenCodeAdapter,
  OpenCodeAdapterConfig,
  OpenCodeCreateOptions,
  OpenCodeModelInfo,
  OpenCodeSessionInfo,
} from "./types";

async function closeRuntime(runtime: OpenCodeRuntime, logger: OpenCodeLogScope): Promise<void> {
  const startedAt = startHarnessLogTimer();
  const metadata = { operation: "closeAdapter" } as const;
  logger.debug(openCodeLogEvents.closeBegin, metadata);

  const result = await Result.tryPromise({
    try: () => runtime.close(),
    catch: (cause) => cause,
  });

  logHarnessResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: openCodeLogEvents.closeSuccess,
    failureEvent: openCodeLogEvents.closeFailure,
    failureLevel: "warn",
  });

  if (result.isErr()) throw result.error;
}

async function createOpenedAdapter(
  runtime: OpenCodeRuntime,
  logger: OpenCodeLogScope,
): Promise<
  Result<
    OpenedHarnessAdapter<"opencode", OpenCodeCreateOptions, OpenCodeSessionInfo, OpenCodeModelInfo>,
    never
  >
> {
  return Result.ok({
    id: "opencode",
    createSession: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "createSession",
        run: () => createSession(runtime, input),
      }),
    resumeSession: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "resumeSession",
        sessionId: input.sessionId,
        run: () => resumeSession(runtime, input),
      }),
    listSessions: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "listSessions",
        run: () => listSessions(runtime, input),
      }),
    getSession: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "getSession",
        sessionId: input.ref.sessionId,
        run: () => getSession(runtime, input),
      }),
    prompt: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "prompt",
        sessionId: input.ref.sessionId,
        run: () => prompt(runtime, input),
      }),
    listModels: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "listModels",
        run: () => listModels(runtime, input),
      }),
    getModel: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "getModel",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => getModel(runtime, input),
      }),
    setModel: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "setModel",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => setModel(runtime, input),
      }),
    getThinking: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "getThinking",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => getThinking(runtime, input),
      }),
    setThinking: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "setThinking",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => setThinking(runtime, input),
      }),
    deleteSession: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "deleteSession",
        sessionId: input.ref.sessionId,
        run: () => deleteSession(runtime, input),
      }),
    abort: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "abort",
        sessionId: input.ref.sessionId,
        run: () => abortSession(runtime, input),
      }),
    respondInteraction: async (input) =>
      logOpenCodeOperation({
        logger,
        operation: "respondInteraction",
        sessionId: input.ref.sessionId,
        run: () => respondInteraction(runtime, input),
      }),
    close: async () => closeRuntime(runtime, logger),
  });
}

export function createOpenCodeAdapter(config?: OpenCodeAdapterConfig): OpenCodeAdapter {
  const parsedConfig = parseOpenCodeAdapterConfig(config);
  const mode = parsedConfig.isOk() ? parsedConfig.value.mode : (config?.mode ?? "embedded");

  return defineHarnessAdapter({
    id: "opencode",
    async open(context) {
      const logger = createOpenCodeLogScope({
        logger: context.logger,
        mode,
      });
      const startedAt = startHarnessLogTimer();
      const metadata = { operation: "openAdapter", mode } as const;
      logger.debug(openCodeLogEvents.openBegin, metadata);

      const result = await Result.gen(async function* () {
        const resolvedConfig = yield* parsedConfig;
        const runtime = yield* Result.await(openRuntime(resolvedConfig));
        const adapter = yield* Result.await(createOpenedAdapter(runtime, logger));
        return Result.ok(adapter);
      });

      logHarnessResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: openCodeLogEvents.openSuccess,
        failureEvent: openCodeLogEvents.openFailure,
      });

      return result;
    },
  });
}
