import { randomUUID } from "node:crypto";
import { createChat, type ChatAdapterDefinitions } from "@xmux/chat-core";
import {
  createHarness,
  HarnessCloseError,
  type HarnessAdapterDefinitions,
} from "@xmux/harness-core";
import { Result } from "better-result";
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
  const harness = createHarness({ adapters: options.harnesses });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);
  const shutdownController = new AbortController();
  const store = options.store ?? createInMemoryStore();
  const fs = options.fs ?? createNodeFileSystemHost();

  const chat = createChat({
    adapters: options.chats,
    commands,
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
      const started = await Result.tryPromise({
        try: () => chat.start(),
        catch: (cause) => new XmuxInitializeError({ cause }),
      });

      if (started.isErr()) {
        return Result.err(started.error);
      }

      return started.value.isOk()
        ? Result.ok()
        : Result.err(new XmuxInitializeError({ cause: started.value.error }));
    },

    async shutdown() {
      shutdownController.abort();
      for (const unsubscribe of routeUnsubscribers) {
        unsubscribe();
      }

      const chatClose = await Result.tryPromise({
        try: () => chat.close(),
        catch: (cause) => cause,
      });
      const harnessClose = await harness.close();

      if (chatClose.isOk() && chatClose.value.isOk() && harnessClose.isOk()) {
        return Result.ok();
      }

      return Result.err(
        new XmuxCloseError({
          chat: chatClose.isErr()
            ? chatClose.error
            : chatClose.value.isErr()
              ? chatClose.value.error
              : undefined,
          harness: harnessClose.isErr() ? harnessClose.error : undefined,
        }),
      );
    },
  };
}
