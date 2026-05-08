import { createMemoryState } from "@chat-adapter/state-memory";
import { createHarness, type HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { Chat, type Adapter } from "chat";
import { XmuxCloseError, XmuxInitializeError } from "./errors";
import type { CreateXmuxOptions, Xmux } from "./contracts";
import { normalizeConfig } from "./config";

export function createXmux<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends Record<string, Adapter>,
>(options: CreateXmuxOptions<TAdapters, TChats>): Xmux<TAdapters, TChats> {
  const config = normalizeConfig(options.config);
  const harness = createHarness({ adapters: options.harnesses });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);

	// TODO: make chat typed
	// Chat<TChats, >
  const chat = new Chat({
    userName: config.userName,
    adapters: options.chats,
		// TODO: change this later
    state: createMemoryState(),
  });

  return {
    harnessIds: harness.harnessIds,
    chatIds,
    config,
    webhooks: chat.webhooks,

    async initialize() {
      return Result.tryPromise({
        try: async () => {
          await chat.initialize();
        },
        catch: (cause) => new XmuxInitializeError({ cause }),
      });
    },

    async shutdown() {
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
