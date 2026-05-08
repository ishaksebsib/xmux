import { createMemoryState } from "@chat-adapter/state-memory";
import { createHarness, type HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { Chat, type Adapter, type Message, type Thread } from "chat";
import { XmuxCloseError, XmuxInitializeError } from "./errors";
import type { CreateXmuxOptions, Xmux } from "./contracts";
import { createXmuxRuntime, handleXmuxIncomingMessage } from "./runtime";
import type { XmuxThreadState } from "./thread-state";
import { normalizeConfig } from "./config";

export function createXmux<
  const TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  const TChats extends Record<string, Adapter>,
>(options: CreateXmuxOptions<TAdapters, TChats>): Xmux<TAdapters, TChats> {
  const config = normalizeConfig(options.config);
  const harness = createHarness({ adapters: options.harnesses });
  const runtime = createXmuxRuntime({
    config,
    harness,
  });
  const chatIds = Object.freeze(Object.keys(options.chats) as Extract<keyof TChats, string>[]);
  const chat = new Chat<TChats, XmuxThreadState>({
    userName: config.userName,
    adapters: options.chats,
		// TODO: change this later
    state: createMemoryState(),
  });

  const handleMessage = async (thread: Thread<XmuxThreadState>, message: Message) => {
    await handleXmuxIncomingMessage({
      runtime,
      thread,
      message,
    });
  };

  chat.onDirectMessage(handleMessage);
  chat.onNewMention(handleMessage);
  chat.onSubscribedMessage(handleMessage);
	// TODO: implement /command for telegram in chat-sdk and replace this
  chat.onNewMessage(/^\/new(?:@[A-Za-z0-9_]+)?\b/i, handleMessage);

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
      runtime.sessions.clear();

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
