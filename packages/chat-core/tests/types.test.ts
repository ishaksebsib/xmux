import { Result } from "better-result";
import { expectTypeOf, test } from "vitest";
import {
  booleanOption,
  createChat,
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
  type AdapterDataFor,
  type AdapterOptionsFor,
  type ChatAdapterDefinitions,
  type ChatCommandValues,
  type ChatOn,
  type ChatSentMessageFromInput,
  type ChatStreamMessageInputFor,
} from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

const basicCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: false,
    attachments: false,
  },
} as const;

const streamCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: true,
    delete: false,
    typing: false,
    markdown: false,
    attachments: false,
    stream: { send: true, reply: true, strategy: "edit" },
  },
} as const;

test("command options infer required, optional, and choice values", () => {
  const commands = defineChatCommands({
    start: defineChatCommand({
      description: "Start a session",
      options: {
        cwd: stringOption({ required: false }),
        harness: stringOption({
          required: true,
          choices: ["opencode", "pi"] as const,
        }),
        retries: numberOption({ choices: [1, 2] as const }),
        dryRun: booleanOption({ required: true }),
      },
    }),
    close: defineChatCommand({
      description: "Close the current session",
    }),
  });

  type Command = ChatCommandValues<typeof commands>;
  type StartCommand = Extract<Command, { readonly name: "start" }>;
  type CloseCommand = Extract<Command, { readonly name: "close" }>;

  expectTypeOf({} as StartCommand["options"]["cwd"]).toEqualTypeOf<string | undefined>();
  expectTypeOf({} as StartCommand["options"]["harness"]).toEqualTypeOf<"opencode" | "pi">();
  expectTypeOf({} as StartCommand["options"]["retries"]).toEqualTypeOf<1 | 2 | undefined>();
  expectTypeOf({} as StartCommand["options"]["dryRun"]).toEqualTypeOf<boolean>();
  expectTypeOf<keyof CloseCommand["options"]>().toEqualTypeOf<never>();
});

test("adapter helper preserves id, option, and data types", () => {
  const discord = defineChatAdapter<
    "discord",
    { readonly allowedMentions: boolean },
    { readonly nativeMessageId: string }
  >({
    id: "discord",
    capabilities: basicCapabilities,
    async open() {
      return Result.ok({
        id: "discord" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "discord" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            format: input.format,
            adapterData: { nativeMessageId: "native-1" },
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  type Adapters = { readonly discord: typeof discord };
  const adapters = { discord } satisfies ChatAdapterDefinitions<Adapters>;

  expectTypeOf(adapters.discord.id).toEqualTypeOf<"discord">();
  expectTypeOf({} as AdapterOptionsFor<Adapters, "discord">).toEqualTypeOf<{
    readonly allowedMentions: boolean;
  }>();
  expectTypeOf({} as AdapterDataFor<Adapters, "discord">).toEqualTypeOf<{
    readonly nativeMessageId: string;
  }>();
});

test("sendMessage narrows adapter options and returned adapter data", () => {
  const discord = defineChatAdapter<
    "discord",
    { readonly allowedMentions: boolean },
    { readonly nativeMessageId: string }
  >({
    id: "discord",
    capabilities: basicCapabilities,
    async open() {
      return Result.ok({
        id: "discord" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "discord" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            adapterData: { nativeMessageId: "native-1" },
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  const defaultsOnly = defineChatAdapter<
    "defaultsOnly",
    { readonly mode?: "safe" | "fast" },
    { readonly mode: "safe" | "fast" }
  >({
    id: "defaultsOnly",
    capabilities: basicCapabilities,
    async open() {
      return Result.ok({
        id: "defaultsOnly" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "defaultsOnly" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            adapterData: { mode: input.adapterOptions.mode ?? "safe" },
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  const chat = createChat({ adapters: { discord, defaultsOnly }, commands: {} });

  expectTypeOf(chat.chatIds).toEqualTypeOf<readonly ("defaultsOnly" | "discord")[]>();

  type DiscordInput = {
    readonly chatId: "discord";
    readonly conversationId: "conversation";
    readonly text: "hello";
    readonly adapterOptions: { readonly allowedMentions: false };
  };
  expectTypeOf(
    {} as ChatSentMessageFromInput<
      { readonly discord: typeof discord },
      DiscordInput
    >["adapterData"],
  ).toEqualTypeOf<{
    readonly nativeMessageId: string;
  }>();

  function assertSendMessageTypes(runtime: typeof chat) {
    void runtime.sendMessage({
      chatId: "discord",
      conversationId: "conversation",
      text: "hello",
      adapterOptions: { allowedMentions: false },
    });

    void runtime.sendMessage({
      chatId: "defaultsOnly",
      conversationId: "conversation",
      text: "hello",
    });

    if (shouldRunTypeErrorChecks) {
      // @ts-expect-error discord requires its adapter options
      void runtime.sendMessage({
        chatId: "discord",
        conversationId: "conversation",
        text: "hello",
        adapterOptions: undefined,
      });
    }
  }

  void assertSendMessageTypes;

  if (shouldRunTypeErrorChecks) {
    createChat({
      adapters: {
        // @ts-expect-error adapter id must match its registration key
        discord: defineChatAdapter<"telegram", Record<never, never>, Record<never, never>>({
          id: "telegram",
          capabilities: basicCapabilities,
          async open() {
            return Result.ok({
              id: "telegram" as const,
              async start() {
                return Result.ok();
              },
              async sendMessage(input) {
                return Result.ok({
                  chatId: "telegram" as const,
                  conversationId: input.conversationId,
                  messageId: "message-1",
                  text: input.text,
                  adapterData: {},
                });
              },
              async close() {
                return undefined;
              },
            });
          },
        }),
      },
      commands: {},
    });
  }
});

test("message events preserve adapter data and event.reply adapter options", () => {
  const discord = defineChatAdapter<
    "discord",
    { readonly allowedMentions: boolean },
    { readonly nativeMessageId: string }
  >({
    id: "discord",
    capabilities: basicCapabilities,
    async open() {
      return Result.ok({
        id: "discord" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "discord" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            adapterData: { nativeMessageId: "native-1" },
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  const chat = createChat({ adapters: { discord }, commands: {} });

  chat.on("message", (event) => {
    if (event.chatId === "discord") {
      expectTypeOf(event.message.adapterData.nativeMessageId).toEqualTypeOf<string>();

      void event.reply("ok", { adapterOptions: { allowedMentions: false } });

      if (shouldRunTypeErrorChecks) {
        // @ts-expect-error event.reply requires adapter options when the adapter requires them
        void event.reply("ok");
      }
    }
  });
});

test("stream fallback is typed from adapter capabilities", () => {
  const nonStreaming = defineChatAdapter<
    "nonStreaming",
    Record<never, never>,
    Record<never, never>,
    typeof basicCapabilities
  >({
    id: "nonStreaming",
    capabilities: basicCapabilities,
    async open() {
      return Result.ok({
        id: "nonStreaming" as const,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "nonStreaming" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            adapterData: {},
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  const streaming = defineChatAdapter<
    "streaming",
    Record<never, never>,
    Record<never, never>,
    typeof streamCapabilities
  >({
    id: "streaming",
    capabilities: streamCapabilities,
    async open() {
      return Result.ok({
        id: "streaming" as const,
        capabilities: streamCapabilities,
        async start() {
          return Result.ok();
        },
        async sendMessage(input) {
          return Result.ok({
            chatId: "streaming" as const,
            conversationId: input.conversationId,
            messageId: "message-1",
            text: input.text,
            adapterData: {},
          });
        },
        async streamMessage(input) {
          return Result.ok({
            chatId: "streaming" as const,
            conversationId: input.conversationId,
            messageId: "stream-1",
            text: "streamed",
            adapterData: {},
          });
        },
        async streamReply(input) {
          return Result.ok({
            chatId: "streaming" as const,
            conversationId: input.conversationId,
            messageId: "stream-reply-1",
            text: "streamed",
            adapterData: {},
          });
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  type Adapters = {
    readonly nonStreaming: typeof nonStreaming;
    readonly streaming: typeof streaming;
  };

  expectTypeOf({} as ChatStreamMessageInputFor<Adapters, "nonStreaming">["fallback"]).toEqualTypeOf<
    "send-message" | undefined
  >();
  expectTypeOf({} as ChatStreamMessageInputFor<Adapters, "streaming">["fallback"]).toEqualTypeOf<
    "send-message" | "error" | undefined
  >();

  const chat = createChat({ adapters: { nonStreaming, streaming }, commands: {} });
  const content = { chunks: createTextChunks() };

  void chat.streamMessage({
    chatId: "nonStreaming",
    conversationId: "conversation",
    content,
    fallback: "send-message",
  });

  void chat.streamMessage({
    chatId: "streaming",
    conversationId: "conversation",
    content,
    fallback: "error",
  });
});

async function* createTextChunks() {
  yield { type: "delta" as const, delta: "hello" };
}

test("command event handlers narrow by command name", () => {
  const commands = defineChatCommands({
    start: defineChatCommand({
      description: "Start a session",
      options: {
        cwd: stringOption({ required: false }),
      },
    }),
    close: defineChatCommand({
      description: "Close the current session",
    }),
  });

  function assertHandlers(on: ChatOn<typeof commands>) {
    on("command", "start", (event) => {
      expectTypeOf(event.command.name).toEqualTypeOf<"start">();
      expectTypeOf(event.command.options.cwd).toEqualTypeOf<string | undefined>();
    });

    on("command", (event) => {
      expectTypeOf(event.command.name).toEqualTypeOf<"start" | "close">();
    });

    if (shouldRunTypeErrorChecks) {
      // @ts-expect-error unknown commands must not be accepted
      on("command", "unknown", () => undefined);
    }
  }

  void assertHandlers;
});
