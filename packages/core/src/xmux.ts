import { randomUUID } from "node:crypto";
import { createChat, type ChatAdapterDefinitions, type ChatLogger } from "@xmux/chat-core";
import {
  createHarness,
  HarnessCloseError,
  type HarnessAdapterDefinitions,
  type HarnessLogger,
} from "@xmux/harness-core";
import { Result } from "better-result";
import { actions } from "./actions";
import { commands } from "./commands";
import { XmuxCloseError, XmuxInitializeError } from "./errors";
import { normalizeConfig, type Config } from "./config";
import { createNodeFileSystemHost, type FileSystemHost } from "./filesystem";
import type { Context } from "./ctx";
import { createPromptRunRegistry } from "./features/prompt/run-registry";
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
  // TODO: change this to xmux logger later
  readonly logger?: ChatLogger & HarnessLogger;
}

export type XmuxCloseCause = {
  readonly harness?: HarnessCloseError;
  readonly chat?: unknown;
};

export function createXmux<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends ChatAdapterDefinitions<TChats>,
>(options: CreateXmuxOptions<TAdapters, TChats>): Xmux<TAdapters, TChats> {
  const config = normalizeConfig(options.config);
  const harness = createHarness({ adapters: options.harnesses, logger: options.logger });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);
  const shutdownController = new AbortController();
  const store = options.store ?? createInMemoryStore();
  const fs = options.fs ?? createNodeFileSystemHost();

  const chat = createChat({
    adapters: options.chats,
    commands,
    actions,
    logger: options.logger,
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
    services: Object.freeze({
      createRequestId: randomUUID,
      now: () => new Date(),
      shutdownSignal: shutdownController.signal,
      promptRuns: createPromptRunRegistry(),
    }),
  });
  const routeUnsubscribers = registerRoutes(ctx, options.middleware ?? []);

  return {
    ctx,

    async initialize() {
      return Result.mapError(await chat.start(), (cause) => new XmuxInitializeError({ cause }));
    },

    async shutdown() {
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
  };
}
