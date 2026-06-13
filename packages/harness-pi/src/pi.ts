import { defineHarnessAdapter, type OpenedHarnessAdapter } from "@xmux/harness-core";
import { Result } from "better-result";
import { abortSession } from "./handlers/abort";
import { createSession } from "./handlers/create-session";
import { deleteSession } from "./handlers/delete-session";
import { getSession } from "./handlers/get-session";
import { listSessions } from "./handlers/list-sessions";
import { getModel, listModels, setModel } from "./handlers/models";
import { prompt } from "./handlers/prompt";
import { resumeSession } from "./handlers/resume-session";
import { getThinking, setThinking } from "./handlers/thinking";
import {
  createPiLogScope,
  logHarnessResult,
  logPiOperation,
  piLogEvents,
  startHarnessLogTimer,
  type PiLogScope,
} from "./logger";
import { normalizeConfig, openRuntime, type PiRuntime } from "./runtime";
import type {
  PiAdapter,
  PiAdapterConfig,
  PiCreateOptions,
  PiModelInfo,
  PiSessionInfo,
} from "./types";

async function closeRuntime(runtime: PiRuntime, logger: PiLogScope): Promise<void> {
  const startedAt = startHarnessLogTimer();
  const metadata = { operation: "closeAdapter", mode: "sdk" } as const;
  logger.debug(piLogEvents.closeBegin, metadata);

  const result = await Result.tryPromise({
    try: () => runtime.close(),
    catch: (cause) => cause,
  });

  logHarnessResult({
    logger,
    result,
    startedAt,
    metadata,
    successEvent: piLogEvents.closeSuccess,
    failureEvent: piLogEvents.closeFailure,
    failureLevel: "warn",
  });

  if (result.isErr()) throw result.error;
}

async function createOpenedAdapter(
  runtime: PiRuntime,
  logger: PiLogScope,
): Promise<Result<OpenedHarnessAdapter<"pi", PiCreateOptions, PiSessionInfo, PiModelInfo>, never>> {
  return Result.ok({
    id: "pi",
    createSession: async (input) =>
      logPiOperation({
        logger,
        operation: "createSession",
        run: () => createSession(runtime, input),
      }),
    resumeSession: async (input) =>
      logPiOperation({
        logger,
        operation: "resumeSession",
        sessionId: input.sessionId,
        run: () => resumeSession(runtime, input),
      }),
    listSessions: async (input) =>
      logPiOperation({
        logger,
        operation: "listSessions",
        run: () => listSessions(runtime, input),
      }),
    getSession: async (input) =>
      logPiOperation({
        logger,
        operation: "getSession",
        sessionId: input.ref.sessionId,
        run: () => getSession(runtime, input),
      }),
    prompt: async (input) =>
      logPiOperation({
        logger,
        operation: "prompt",
        sessionId: input.ref.sessionId,
        run: () => prompt(runtime, input),
      }),
    listModels: async (input) =>
      logPiOperation({
        logger,
        operation: "listModels",
        run: () => listModels(runtime, input),
      }),
    getModel: async (input) =>
      logPiOperation({
        logger,
        operation: "getModel",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => getModel(runtime, input),
      }),
    setModel: async (input) =>
      logPiOperation({
        logger,
        operation: "setModel",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => setModel(runtime, input),
      }),
    getThinking: async (input) =>
      logPiOperation({
        logger,
        operation: "getThinking",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => getThinking(runtime, input),
      }),
    setThinking: async (input) =>
      logPiOperation({
        logger,
        operation: "setThinking",
        sessionId: input.target.type === "session" ? input.target.ref.sessionId : undefined,
        run: () => setThinking(runtime, input),
      }),
    deleteSession: async (input) =>
      logPiOperation({
        logger,
        operation: "deleteSession",
        sessionId: input.ref.sessionId,
        run: () => deleteSession(runtime, input),
      }),
    abort: async (input) =>
      logPiOperation({
        logger,
        operation: "abort",
        sessionId: input.ref.sessionId,
        run: () => abortSession(runtime, input),
      }),
    close: async () => closeRuntime(runtime, logger),
  });
}

export function createPiAdapter(config?: PiAdapterConfig): PiAdapter {
  const normalizedConfig = normalizeConfig(config);

  return defineHarnessAdapter({
    id: "pi",
    async open(context) {
      const logger = createPiLogScope({ logger: context.logger });
      const startedAt = startHarnessLogTimer();
      const metadata = { operation: "openAdapter", mode: "sdk" } as const;
      logger.debug(piLogEvents.openBegin, metadata);

      const result = await Result.gen(async function* () {
        const runtime = yield* Result.await(openRuntime(normalizedConfig));
        const adapter = yield* Result.await(createOpenedAdapter(runtime, logger));
        return Result.ok(adapter);
      });

      logHarnessResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: piLogEvents.openSuccess,
        failureEvent: piLogEvents.openFailure,
      });

      return result;
    },
  });
}
