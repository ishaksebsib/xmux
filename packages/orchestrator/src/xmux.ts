import { randomUUID } from "node:crypto";
import {
  createChat,
  type ChatAdapterDefinitions,
  type ChatRuntimeStatusSnapshot,
} from "@xmux/chat-core";
import {
  createHarness,
  type HarnessAdapterDefinitions,
  type HarnessCloseError,
  type HarnessRuntimeStatusSnapshot,
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
export interface XmuxRuntimeStatusSnapshot<
  THarnessId extends string = string,
  TChatId extends string = string,
> {
  readonly chats: ChatRuntimeStatusSnapshot<TChatId>;
  readonly harnesses: HarnessRuntimeStatusSnapshot<THarnessId>;
}

export interface Xmux<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: Context<TAdapters, TChats>;
  status(): XmuxRuntimeStatusSnapshot<
    Extract<keyof TAdapters, string>,
    Extract<keyof TChats, string>
  >;
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
  /** Store owned and closed by this Xmux runtime for its complete lifetime. */
  readonly store?: Store;
  readonly fs?: FileSystemHost;
  readonly middleware?: readonly XmuxMiddleware<TAdapters, TChats>[];
  readonly logger?: XmuxLogger;
}

export type XmuxCloseCause = {
  readonly harness?: HarnessCloseError;
  readonly chat?: unknown;
  readonly store?: unknown;
  readonly runtime?: unknown;
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

    status() {
      return {
        chats: chat.status(),
        harnesses: harness.status(),
      };
    },

    async initialize() {
      const startedAt = startXmuxLogTimer();
      const metadata = { operation: "initialize" } satisfies XmuxLogMetadata;
      logger.debug(xmuxLogEvents.initializeBegin, metadata);

      const storeStarted = Result.andThen(
        await Result.tryPromise({
          try: () => store.initialize(),
          catch: (cause) => new XmuxInitializeError({ cause }),
        }),
        (inner) => Result.mapError(inner, (cause) => new XmuxInitializeError({ cause })),
      );
      let result = storeStarted;

      if (result.isOk()) {
        const chatStarted = Result.andThen(
          await Result.tryPromise({
            try: () => chat.start(),
            catch: (cause) => new XmuxInitializeError({ cause }),
          }),
          (inner) => Result.mapError(inner, (cause) => new XmuxInitializeError({ cause })),
        );
        result = chatStarted;

        if (result.isErr()) {
          const storeClosed = Result.flatten(
            await Result.tryPromise({
              try: () => store.close(),
              catch: (cause) => cause,
            }),
          );
          if (storeClosed.isErr()) {
            result = Result.err(
              new XmuxInitializeError({
                cause: result.error.cause,
                rollbackCause: storeClosed.error,
              }),
            );
          }
        }
      }

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

      const runtimeClose = Result.try({
        try: () => {
          shutdownController.abort();
          for (const unsubscribe of routeUnsubscribers) {
            unsubscribe();
          }
        },
        catch: (cause) => cause,
      });
      const chatClose = Result.flatten(
        await Result.tryPromise({ try: () => chat.close(), catch: (cause) => cause }),
      );
      const harnessCloseBoundary = await Result.tryPromise({
        try: () => harness.close(),
        catch: (cause) => cause,
      });
      const harnessError =
        harnessCloseBoundary.isOk() && harnessCloseBoundary.value.isErr()
          ? harnessCloseBoundary.value.error
          : undefined;
      const storeClose = Result.flatten(
        await Result.tryPromise({ try: () => store.close(), catch: (cause) => cause }),
      );

      const runtimeFailures = [
        ...(runtimeClose.isErr() ? [runtimeClose.error] : []),
        ...(harnessCloseBoundary.isErr() ? [harnessCloseBoundary.error] : []),
      ];
      const cause: XmuxCloseCause = {
        ...(runtimeFailures.length === 0
          ? {}
          : {
              runtime:
                runtimeFailures.length === 1
                  ? runtimeFailures[0]
                  : new AggregateError(runtimeFailures, "Xmux runtime cleanup failed"),
            }),
        ...(chatClose.isErr() ? { chat: chatClose.error } : {}),
        ...(harnessError === undefined ? {} : { harness: harnessError }),
        ...(storeClose.isErr() ? { store: storeClose.error } : {}),
      };
      const result =
        cause.runtime === undefined &&
        cause.chat === undefined &&
        cause.harness === undefined &&
        cause.store === undefined
          ? Result.ok<void, XmuxCloseError>(undefined)
          : Result.err<void, XmuxCloseError>(new XmuxCloseError(cause));

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
