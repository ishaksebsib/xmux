import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createHarness,
  HarnessCloseError,
  type HarnessAdapterDefinitions,
} from "@xmux/harness-core";
import { Result } from "better-result";
import { Chat, type Adapter } from "chat";
import { XmuxCloseError, XmuxInitializeError } from "./errors";
import { normalizeConfig, type XmuxConfig } from "./config";
import type { XmuxContext } from "./ctx";
import { createInMemoryStore } from "./in-memory-store";
import type { XmuxStore } from "./store";

/**
 * Main xmux instance - manages harnesses and chats together.
 * Provides lifecycle control and webhook access.
 */
export interface Xmux<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends Record<string, Adapter>,
> {
  readonly ctx: XmuxContext<TAdapters, TChats>;
  initialize(): Promise<Result<void, XmuxInitializeError>>;
  shutdown(): Promise<Result<void, XmuxCloseError>>;
}

export interface CreateXmuxOptions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends Record<string, Adapter>,
> {
  readonly harnesses: TAdapters;
  readonly chats: TChats;
  readonly config: XmuxConfig;
  readonly store?: XmuxStore;
}

export type XmuxCloseCause = {
  readonly harness?: HarnessCloseError;
  readonly chat?: unknown;
};

export function createXmux<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends Record<string, Adapter>,
>(options: CreateXmuxOptions<TAdapters, TChats>): Xmux<TAdapters, TChats> {
  const config = normalizeConfig(options.config);
  const harness = createHarness({ adapters: options.harnesses });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);
  const shutdownController = new AbortController();
  const store = options.store ?? createInMemoryStore();

  // TODO: make chat typed
  // Chat<TChats, >
  const chat = new Chat({
    userName: config.userName,
    adapters: options.chats,
    // TODO: change this later
    state: createMemoryState(),
  });

  const ctx: XmuxContext<TAdapters, TChats> = Object.freeze({
    kind: "xmux",
    config,
    harnessIds: harness.harnessIds,
    chatIds,
    harness,
    webhooks: chat.webhooks,
    store,
    services: Object.freeze({
      now: () => new Date(),
      shutdownSignal: shutdownController.signal,
    }),
  });

  return {
    ctx,

    async initialize() {
      return Result.tryPromise({
        try: async () => {
          await chat.initialize();
        },
        catch: (cause) => new XmuxInitializeError({ cause }),
      });
    },

    async shutdown() {
      shutdownController.abort();

      const chatClose = await Result.tryPromise({
        try: async () => {
          await chat.shutdown();
        },
        catch: (cause) => cause,
      });
      const harnessClose = await harness.close();

      if (chatClose.isOk() && harnessClose.isOk()) {
        return Result.ok();
      }

      return Result.err(
        new XmuxCloseError({
          chat: chatClose.isErr() ? chatClose.error : undefined,
          harness: harnessClose.isErr() ? harnessClose.error : undefined,
        }),
      );
    },
  };
}
