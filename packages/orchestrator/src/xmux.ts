import { randomUUID } from "node:crypto";
import { createChat, type ChatAdapterDefinitions } from "@xmux/chat-core";
import {
  createHarness,
  type HarnessAdapterDefinitions,
  type HarnessCloseError,
} from "@xmux/harness-core";
import { Result } from "better-result";
import { actions } from "./actions";
import { commands } from "./commands";
import { XmuxCloseError, XmuxInitializeError, type XmuxConfigurationError } from "./errors";
import { parseXmuxConfig, type Config } from "./config";
import { createNodeFileSystemHost, type FileSystemHost } from "./filesystem";
import type { Context } from "./ctx";
import { createPromptEventBus } from "./features/prompt/events";
import { createMenuRegistry } from "./features/menu/registry";
import { createPromptRunRegistry } from "./features/prompt/run-registry";
import { createPromptQueueRegistry } from "./features/queue/registry";
import { createSttRunRegistry } from "./features/stt/run-registry";
import type { XmuxLogMetadata } from "./logger";
import { xmuxLogEvents, type XmuxLogger } from "./logger";
import {
  createContextualXmuxLogger,
  createXmuxLogScope,
  logXmuxResult,
  serializeXmuxLogError,
  startXmuxLogTimer,
} from "./logger-utils";
import type { XmuxMiddleware } from "./middleware";
import { registerRoutes } from "./router";
import { createInMemoryStore } from "./store";
import type { Store } from "./store";

/**
 * Main instance that manages harnesses and chats together.
 * Provides lifecycle control and chat runtime access.
 */
export interface Xmux<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: Context<TAdapters, TChats>;
  initialize(): Promise<Result<void, XmuxInitializeError>>;
  shutdown(): Promise<Result<void, XmuxCloseError>>;
}

export interface CreateXmuxOptions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly harnesses: TAdapters;
  readonly chats: TChats;
  readonly config: Config;
  readonly store?: Store;
  readonly fs?: FileSystemHost;
  readonly middleware?: readonly XmuxMiddleware<TAdapters, TChats>[];
  readonly logger?: XmuxLogger;
}

export type XmuxCloseCause = {
  readonly harness?: HarnessCloseError;
  readonly chat?: unknown;
};

export function createXmuxResult<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends ChatAdapterDefinitions<TChats>,
>(
  options: CreateXmuxOptions<TAdapters, TChats>,
): Result<Xmux<TAdapters, TChats>, XmuxConfigurationError> {
  const contextualLogger = createContextualXmuxLogger(options.logger);
  const logger = createXmuxLogScope(contextualLogger, {
    component: "@xmux/orchestrator",
    packageName: "@xmux/orchestrator",
  });

  const parsedConfig = parseXmuxConfig(options.config);
  if (parsedConfig.isErr()) {
    logger.error(xmuxLogEvents.configFailure, {
      result: "error",
      error: serializeXmuxLogError(parsedConfig.error),
    });
    return Result.err(parsedConfig.error);
  }

  const config = parsedConfig.value;
  const harness = createHarness({ adapters: options.harnesses, logger: contextualLogger });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);
  const shutdownController = new AbortController();
  const store = options.store ?? createInMemoryStore();
  const fs = options.fs ?? createNodeFileSystemHost();

  const chat = createChat({
    adapters: options.chats,
    commands,
    actions,
    logger: contextualLogger,
  });

  const ctx: Context<TAdapters, TChats> = Object.freeze({
    kind: "xmux",
    config,
    harnessIds: harness.harnessIds,
    chatIds,
    harness,
    chat,
    store,
    fs,
    logger,
    services: Object.freeze({
      createRequestId: randomUUID,
      now: () => new Date(),
      shutdownSignal: shutdownController.signal,
      promptEvents: createPromptEventBus(),
      promptRuns: createPromptRunRegistry(),
      promptQueue: createPromptQueueRegistry({
        maxItems: config.queue.maxItems,
        offerTtlMs: config.queue.offerTtlMs,
      }),
      sttRuns: createSttRunRegistry(),
      menu: createMenuRegistry(),
    }),
  });
  const routeUnsubscribers = registerRoutes(ctx, options.middleware ?? []);

  return Result.ok({
    ctx,

    async initialize() {
      const startedAt = startXmuxLogTimer();
      const metadata = { operation: "initialize" } satisfies XmuxLogMetadata;
      logger.debug(xmuxLogEvents.initializeBegin, metadata);

      const started = await Result.tryPromise({
        try: () => chat.start(),
        catch: (cause) => new XmuxInitializeError({ cause }),
      });
      const result = Result.andThen(started, (inner) =>
        Result.mapError(inner, (cause) => new XmuxInitializeError({ cause })),
      );

      logXmuxResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: xmuxLogEvents.initializeSuccess,
        failureEvent: xmuxLogEvents.initializeFailure,
        failureLevel: "error",
      });

      return result;
    },

    async shutdown() {
      const startedAt = startXmuxLogTimer();
      const metadata = { operation: "shutdown" } satisfies XmuxLogMetadata;
      logger.debug(xmuxLogEvents.shutdownBegin, metadata);

      const closed = await Result.tryPromise({
        try: async () => {
          shutdownController.abort();
          for (const unsubscribe of routeUnsubscribers) {
            unsubscribe();
          }

          const chatClose = await chat.close();
          const harnessClose = await harness.close();

          const chatError = chatClose.isErr() ? chatClose.error : undefined;
          const harnessError = harnessClose.isErr() ? harnessClose.error : undefined;

          return chatError === undefined && harnessError === undefined
            ? Result.ok()
            : Result.err(new XmuxCloseError({ chat: chatError, harness: harnessError }));
        },
        catch: (cause) => new XmuxCloseError({ chat: cause }),
      });
      const result = Result.andThen(closed, (inner) => inner);

      logXmuxResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: xmuxLogEvents.shutdownSuccess,
        failureEvent: xmuxLogEvents.shutdownFailure,
        failureLevel: "warn",
      });

      return result;
    },
  });
}

/**
 * Legacy convenience factory. New callers should prefer `createXmuxResult()` so
 * malformed configuration remains an explicit typed Result error.
 */
export function createXmux<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends ChatAdapterDefinitions<TChats>,
>(options: CreateXmuxOptions<TAdapters, TChats>): Xmux<TAdapters, TChats> {
  const created = createXmuxResult(options);
  if (created.isErr()) throw created.error;
  return created.value;
}
