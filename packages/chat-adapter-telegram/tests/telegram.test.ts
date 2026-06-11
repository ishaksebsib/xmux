import { describe, expect, test, vi } from "vitest";
import {
  createTelegramAdapter,
  type TelegramAdapterData,
  type TelegramAdapterOptions,
} from "../src";
import {
  TelegramCommandRegistrationError,
  TelegramConfigurationError,
  TelegramReplyError,
  TelegramSendMessageError,
  TelegramSendTypingError,
  TelegramStartError,
  TelegramStreamMessageError,
  TelegramStreamReplyError,
  TelegramWebhookModeUnsupportedError,
} from "../src/errors";
import type {
  TelegramCallbackQueryDataContext,
  TelegramMessageContext,
  TelegramTextMessageContext,
} from "../src/client";
import { openTelegramRuntime } from "../src/runtime";
import {
  renderTelegramMarkdownFinal,
  renderTelegramMarkdownPreview,
  validateTelegramEntities,
} from "../src/conversions/markdown-entities";
import { splitTelegramRenderedText } from "../src/conversions/telegram-segments";
import {
  booleanOption,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
  type ChatAdapterDefinition,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";

function createStartContext<
  TChatId extends string,
  TCommands extends ChatCommandRegistry = Record<never, never>,
>(args: {
  readonly chatId: TChatId;
  readonly commands?: TCommands;
  readonly signal?: AbortSignal;
  readonly diagnostics?: string[];
  readonly errors?: unknown[];
  readonly events?: unknown[];
}): ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData> {
  return {
    commands: (args.commands ?? {}) as TCommands,
    emit: (event) => {
      args.events?.push(event);
      if (event.type === "error") {
        args.errors?.push(event.error);
      }
    },
    diagnostic: (diagnostic) => {
      args.diagnostics?.push(diagnostic.code);
    },
    signal: args.signal,
  };
}

type CreateBotClient = NonNullable<
  Parameters<typeof openTelegramRuntime<"telegram">>[0]["createBot"]
>;

type FakeTelegramBot = ReturnType<CreateBotClient> & {
  readonly editMessageTextMock: ReturnType<typeof vi.fn>;
  readonly initMock: ReturnType<typeof vi.fn>;
  readonly startMock: ReturnType<typeof vi.fn>;
  readonly stopMock: ReturnType<typeof vi.fn>;
  readonly catchMock: ReturnType<typeof vi.fn>;
  readonly getBotInfoMock: ReturnType<typeof vi.fn>;
  readonly answerCallbackQueryMock: ReturnType<typeof vi.fn>;
  readonly onCallbackQueryDataMock: ReturnType<typeof vi.fn>;
  readonly onMessageMock: ReturnType<typeof vi.fn>;
  readonly onTextMessageMock: ReturnType<typeof vi.fn>;
  readonly sendMessageMock: ReturnType<typeof vi.fn>;
  readonly sendMessageDraftMock: ReturnType<typeof vi.fn>;
  readonly deleteMessageMock: ReturnType<typeof vi.fn>;
  readonly sendChatActionMock: ReturnType<typeof vi.fn>;
  readonly setMyCommandsMock: ReturnType<typeof vi.fn>;
  readonly streamMessageMock: ReturnType<typeof vi.fn>;
  readonly getFileMock: ReturnType<typeof vi.fn>;
  readonly downloadFileMock: ReturnType<typeof vi.fn>;
  readonly emitCallbackQueryData: (context: TelegramCallbackQueryDataContext) => Promise<void>;
  readonly emitMessage: (context: TelegramMessageContext) => Promise<void>;
  readonly emitTextMessage: (context: TelegramTextMessageContext) => Promise<void>;
  readonly rejectPolling: (cause: unknown) => void;
};

function createFakeTelegramBot(
  args: {
    readonly initError?: unknown;
    readonly sendMessageError?: unknown;
    readonly sendMessageDraftError?: unknown;
    readonly editMessageTextError?: unknown;
    readonly sendChatActionError?: unknown;
    readonly setMyCommandsError?: unknown;
    readonly startError?: unknown;
    readonly getFileError?: unknown;
    readonly downloadFileError?: unknown;
  } = {},
): FakeTelegramBot {
  let running = false;
  let rejectPolling: (cause: unknown) => void = () => undefined;
  let resolvePolling: () => void = () => undefined;

  const polling = new Promise<void>((resolve, reject) => {
    resolvePolling = resolve;
    rejectPolling = reject;
  });
  const initMock = vi.fn(async () => {
    if (args.initError !== undefined) {
      throw args.initError;
    }
  });
  const startMock = vi.fn(() => {
    if (args.startError !== undefined) {
      throw args.startError;
    }

    running = true;
    return polling;
  });
  const stopMock = vi.fn(async () => {
    running = false;
    resolvePolling();
  });
  const catchMock = vi.fn();
  const getBotInfoMock = vi.fn(() => ({
    id: 999,
    is_bot: true,
    first_name: "Xmux",
    username: "xmux_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    can_manage_bots: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  }));
  const messageHandlers: Array<(context: TelegramMessageContext) => void | Promise<void>> = [];
  const textMessageHandlers: Array<(context: TelegramTextMessageContext) => void | Promise<void>> =
    [];
  const callbackQueryDataHandlers: Array<
    (context: TelegramCallbackQueryDataContext) => void | Promise<void>
  > = [];
  const answerCallbackQueryMock = vi.fn(async () => true);
  const editMessageTextMock = vi.fn(
    async (_input: {
      readonly chatId: string | number;
      readonly messageId: number;
      readonly text: string;
    }) => {
      if (args.editMessageTextError !== undefined) {
        throw args.editMessageTextError;
      }
      return true;
    },
  );
  const onCallbackQueryDataMock = vi.fn(
    (handler: (context: TelegramCallbackQueryDataContext) => void | Promise<void>) => {
      callbackQueryDataHandlers.push(handler);
    },
  );
  const onMessageMock = vi.fn(
    (handler: (context: TelegramMessageContext) => void | Promise<void>) => {
      messageHandlers.push(handler);
    },
  );
  const onTextMessageMock = vi.fn(
    (handler: (context: TelegramTextMessageContext) => void | Promise<void>) => {
      textMessageHandlers.push(handler);
    },
  );
  let nextSentMessageId = 123;
  const sendMessageMock = vi.fn(
    async (input: {
      readonly chatId: string | number;
      readonly text: string;
      readonly options?: { readonly entities?: readonly unknown[] };
    }) => {
      if (args.sendMessageError !== undefined) {
        throw args.sendMessageError;
      }

      return {
        message_id: nextSentMessageId++,
        date: 1,
        chat: { id: input.chatId, type: "private", first_name: "Alice" },
        text: input.text,
        entities: input.options?.entities,
      };
    },
  );
  const sendMessageDraftMock = vi.fn(async () => {
    if (args.sendMessageDraftError !== undefined) {
      throw args.sendMessageDraftError;
    }
    return true;
  });
  const deleteMessageMock = vi.fn(async () => true);
  const sendChatActionMock = vi.fn(
    async (_input: {
      readonly chatId: string | number;
      readonly action: string;
      readonly options?: unknown;
    }) => {
      if (args.sendChatActionError !== undefined) {
        throw args.sendChatActionError;
      }

      return true;
    },
  );
  const setMyCommandsMock = vi.fn(async () => {
    if (args.setMyCommandsError !== undefined) {
      throw args.setMyCommandsError;
    }
    return true;
  });
  const getFileMock = vi.fn(async (input: { readonly fileId: string }) => {
    if (args.getFileError !== undefined) {
      throw args.getFileError;
    }

    return {
      file_id: input.fileId,
      file_unique_id: `${input.fileId}-unique`,
      file_size: 3,
      file_path: `documents/${input.fileId}`,
    };
  });
  const downloadFileMock = vi.fn(async () => {
    if (args.downloadFileError !== undefined) {
      throw args.downloadFileError;
    }

    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    });
  });
  const streamMessageMock = vi.fn(
    async (input: { readonly chatId: number; readonly stream: AsyncIterable<string> }) => {
      let text = "";
      for await (const chunk of input.stream) {
        text += chunk;
      }

      return [
        {
          message_id: 124,
          date: 1,
          chat: { id: input.chatId, type: "private", first_name: "Alice" },
          text,
        },
      ];
    },
  );

  return {
    catch: catchMock,
    answerCallbackQuery: answerCallbackQueryMock,
    downloadFile: downloadFileMock,
    editMessageText: editMessageTextMock,
    getBotInfo: getBotInfoMock,
    getFile: getFileMock,
    init: initMock,
    isRunning: () => running,
    start: startMock,
    stop: stopMock,
    onCallbackQueryData: onCallbackQueryDataMock,
    onMessage: onMessageMock,
    onTextMessage: onTextMessageMock,
    sendMessage: sendMessageMock,
    sendMessageDraft: sendMessageDraftMock,
    deleteMessage: deleteMessageMock,
    sendChatAction: sendChatActionMock,
    setMyCommands: setMyCommandsMock,
    streamMessage: streamMessageMock,
    initMock,
    startMock,
    stopMock,
    catchMock,
    getBotInfoMock,
    answerCallbackQueryMock,
    onCallbackQueryDataMock,
    onMessageMock,
    onTextMessageMock,
    getFileMock,
    downloadFileMock,
    sendMessageMock,
    sendMessageDraftMock,
    deleteMessageMock,
    sendChatActionMock,
    setMyCommandsMock,
    streamMessageMock,
    editMessageTextMock,
    emitCallbackQueryData: async (context) => {
      for (const handler of callbackQueryDataHandlers) {
        await handler(context);
      }
    },
    emitMessage: async (context) => {
      for (const handler of messageHandlers) {
        await handler(context);
      }
    },
    emitTextMessage: async (context) => {
      for (const handler of messageHandlers) {
        await handler(context);
      }
      for (const handler of textMessageHandlers) {
        await handler(context);
      }
    },
    rejectPolling,
  } as FakeTelegramBot;
}

function createRuntimeWithFakeBot(args: {
  readonly bot: FakeTelegramBot;
  readonly mode?: Parameters<typeof openTelegramRuntime<"telegram">>[0]["mode"];
}) {
  return openTelegramRuntime({
    chatId: "telegram",
    options: { token: "123:test" },
    mode: args.mode ?? { type: "polling" },
    createBot: () => args.bot,
  });
}

async function* textChunks(parts: readonly string[]) {
  for (const delta of parts) {
    yield { type: "delta" as const, delta };
  }
}

function createDeferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createTelegramMessageContext(args: {
  readonly message: Record<string, unknown>;
  readonly chatId?: number;
  readonly messageId?: number;
  readonly updateId?: number;
  readonly from?: {
    readonly id: number;
    readonly is_bot: boolean;
    readonly first_name: string;
    readonly last_name?: string;
    readonly username?: string;
  };
}): TelegramMessageContext {
  const chat = { id: args.chatId ?? -100, type: "private", first_name: "Alice" };
  const message = {
    message_id: args.messageId ?? 10,
    date: 1,
    chat,
    from: args.from,
    ...args.message,
  };

  return {
    update: {
      update_id: args.updateId ?? 20,
      message,
    },
    message,
  } as unknown as TelegramMessageContext;
}

function createTelegramTextContext(args: {
  readonly text: string;
  readonly from?: {
    readonly id: number;
    readonly is_bot: boolean;
    readonly first_name: string;
    readonly last_name?: string;
    readonly username?: string;
  };
  readonly chatId?: number;
  readonly messageId?: number;
  readonly updateId?: number;
  readonly botId?: number;
  readonly entities?: readonly {
    readonly type: "bot_command";
    readonly offset: number;
    readonly length: number;
  }[];
}): TelegramTextMessageContext {
  const chat = { id: args.chatId ?? -100, type: "private", first_name: "Alice" };
  const message = {
    message_id: args.messageId ?? 10,
    date: 1,
    chat,
    from: args.from,
    text: args.text,
    entities: args.entities,
  };

  return {
    update: {
      update_id: args.updateId ?? 20,
      message,
    },
    message,
    me: {
      id: args.botId ?? 999,
      is_bot: true,
      first_name: "ThisBot",
      username: "ThisBot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    },
  } as unknown as TelegramTextMessageContext;
}

describe("Telegram markdown entity rendering", () => {
  test("renders healed markdown previews without raw markers", () => {
    const rendered = renderTelegramMarkdownPreview("**hel");

    expect(rendered).toEqual({
      text: "hel",
      entities: [{ type: "bold", offset: 0, length: 3 }],
    });
    expect(rendered.text).not.toContain("**");
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("renders nested blockquote formatting in valid outer-first entity order", () => {
    const rendered = renderTelegramMarkdownPreview("> **Reasoning**\n>\n> The user said hello.");

    expect(rendered.entities).toEqual([
      { type: "blockquote", offset: 0, length: 31 },
      { type: "bold", offset: 0, length: 9 },
    ]);
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("renders tables as plain text, not pre/code blocks", () => {
    const rendered = renderTelegramMarkdownFinal(
      "| Name | Role |\n| --- | --- |\n| Ishak | Author |",
    );

    expect(rendered).toEqual({
      text: "Name | Role\nIshak | Author",
      entities: [],
    });
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("does not emit entities nested inside code spans", () => {
    const rendered = renderTelegramMarkdownPreview("> `**not bold**`");

    expect(rendered).toEqual({
      text: "**not bold**",
      entities: [{ type: "code", offset: 0, length: 12 }],
    });
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("renders final markdown as plain text plus Telegram entities", () => {
    const rendered = renderTelegramMarkdownFinal("**hello** from hello_world");

    expect(rendered).toEqual({
      text: "hello from hello_world",
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
    expect(rendered.text).not.toContain("\\_");
    expect(validateTelegramEntities(rendered).isOk()).toBe(true);
  });

  test("splits long entity spans with segment-local offsets", () => {
    const rendered = renderTelegramMarkdownFinal(`**${"a".repeat(4_100)}**`);
    const segments = splitTelegramRenderedText(rendered);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toHaveLength(4_096);
    expect(segments[0]?.entities).toEqual([{ type: "bold", offset: 0, length: 4_096 }]);
    expect(segments[1]?.entities).toEqual([{ type: "bold", offset: 0, length: 4 }]);
  });

  test("does not split inside emoji surrogate pairs", () => {
    const segments = splitTelegramRenderedText({ text: "a😀b", entities: [] }, 2);

    expect(segments.map((segment) => segment.text)).toEqual(["a", "😀", "b"]);
  });
});

describe("createTelegramAdapter", () => {
  test("preserves the default and custom adapter ids", () => {
    const defaultAdapter = createTelegramAdapter({ token: "123:test" });
    const customAdapter = createTelegramAdapter({ id: "support", token: "123:test" });

    expect(defaultAdapter.id).toBe("telegram");
    expect(customAdapter.id).toBe("support");
  });

  test("mode allowedUpdates are typed from Telegram update names", () => {
    createTelegramAdapter({
      token: "123:test",
      mode: { type: "polling", allowedUpdates: ["message", "callback_query"] },
    });

    createTelegramAdapter({
      token: "123:test",
      mode: { type: "webhook", allowedUpdates: ["message"] },
    });

    createTelegramAdapter({
      token: "123:test",
      // @ts-expect-error invalid Telegram update names should not compile
      mode: { type: "polling", allowedUpdates: ["bad"] },
    });
  });

  test("returns typed adapter definitions", () => {
    const adapter = createTelegramAdapter({ id: "telegram", token: "123:test" });

    expect(adapter).toSatisfy(
      (_adapter: ChatAdapterDefinition<"telegram", TelegramAdapterOptions, TelegramAdapterData>) =>
        true,
    );
  });

  test("open rejects an empty token", async () => {
    const adapter = createTelegramAdapter({ token: " " });

    const opened = await adapter.open({});

    expect(opened.isErr()).toBe(true);
    if (opened.isErr()) {
      expect(opened.error).toBeInstanceOf(TelegramConfigurationError);
    }
  });

  test("open returns a runtime with capabilities", async () => {
    const adapter = createTelegramAdapter({ token: "123:test" });

    const opened = await adapter.open({});

    expect(opened.isOk()).toBe(true);
    if (opened.isOk()) {
      expect(opened.value.id).toBe("telegram");
      expect(opened.value.capabilities?.messages.send).toBe(true);
      expect(opened.value.capabilities?.messages.typing).toBe(true);
      expect(opened.value.capabilities?.messages.stream?.send).toBe(true);
      expect(opened.value.capabilities?.commands?.registration).toBe("dynamic");
    }
  });

  test("webhook mode is explicit but unsupported in this phase", async () => {
    const adapter = createTelegramAdapter({
      token: "123:test",
      mode: { type: "webhook", secretToken: "secret" },
    });
    const opened = await adapter.open({});
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramWebhookModeUnsupportedError);
    }
  });

  test("polling start initializes grammY and starts polling", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({
      bot,
      mode: {
        type: "polling",
        dropPendingUpdates: true,
        allowedUpdates: ["message"],
      },
    });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isOk()).toBe(true);
    expect(bot.catchMock).toHaveBeenCalledTimes(1);
    expect(bot.initMock).toHaveBeenCalledTimes(1);
    expect(bot.startMock).toHaveBeenCalledWith({
      drop_pending_updates: true,
      allowed_updates: ["message"],
    });
  });

  test("polling start registers Telegram commands and emits capability diagnostics", async () => {
    const bot = createFakeTelegramBot();
    const diagnostics: string[] = [];
    const commands = defineChatCommands({
      start: defineChatCommand({
        description: "Start session",
        options: {
          harness: stringOption({ choices: ["opencode", "pi"] as const }),
        },
      }),
      BadName: defineChatCommand({ description: "Invalid Telegram name" }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, diagnostics }),
    );

    expect(started.isOk()).toBe(true);
    expect(bot.setMyCommandsMock).toHaveBeenCalledWith({
      commands: [{ command: "start", description: "Start session" }],
      signal: undefined,
    });
    expect(diagnostics).toEqual([
      "COMMAND_NAME_INVALID",
      "COMMAND_OPTIONS_NOT_SUPPORTED",
      "COMMAND_CHOICES_NOT_SUPPORTED",
    ]);
  });

  test("polling start returns typed command registration failures", async () => {
    const bot = createFakeTelegramBot({ setMyCommandsError: new Error("registration failed") });
    const commands = defineChatCommands({
      start: defineChatCommand({ description: "Start session" }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", commands }));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramCommandRegistrationError);
      if (TelegramCommandRegistrationError.is(started.error)) {
        expect(started.error.message).toContain("registration failed");
      }
    }
  });

  test("polling start returns typed init failures", async () => {
    const bot = createFakeTelegramBot({ initError: new Error("init failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram" }));

    expect(started.isErr()).toBe(true);
    if (started.isErr()) {
      expect(started.error).toBeInstanceOf(TelegramStartError);
      if (TelegramStartError.is(started.error)) {
        expect(started.error.message).toContain("init failed");
      }
    }
  });

  test("abort signal stops polling", async () => {
    const bot = createFakeTelegramBot();
    const abortController = new AbortController();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", signal: abortController.signal }),
    );
    expect(started.isOk()).toBe(true);

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bot.stopMock).toHaveBeenCalledTimes(1);
  });

  test("polling failures are emitted as runtime errors", async () => {
    const bot = createFakeTelegramBot();
    const errors: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", errors }));
    expect(started.isOk()).toBe(true);

    const cause = new Error("polling failed");
    bot.rejectPolling(cause);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual([cause]);
  });

  test("text updates emit normalized message events", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "hello telegram",
        chatId: 12345,
        messageId: 777,
        updateId: 888,
        from: {
          id: 42,
          is_bot: false,
          first_name: "Alice",
          last_name: "Example",
          username: "alice",
        },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "message",
      chatId: "telegram",
      conversation: {
        chatId: "telegram",
        conversationId: "12345",
      },
      message: {
        chatId: "telegram",
        conversationId: "12345",
        messageId: "777",
        text: "hello telegram",
        format: "plain",
        actor: {
          kind: "user",
          actorId: "42",
          displayName: "Alice Example",
        },
        adapterData: {
          telegramChatId: "12345",
          telegramMessageId: 777,
          updateId: 888,
        },
      },
    });
  });

  test("document updates emit lazy downloadable attachments", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitMessage(
      createTelegramMessageContext({
        chatId: 12345,
        messageId: 777,
        updateId: 888,
        from: { id: 42, is_bot: false, first_name: "Alice" },
        message: {
          caption: "please read",
          document: {
            file_id: "pdf-file-id",
            file_unique_id: "pdf-unique-id",
            file_name: "brief.pdf",
            mime_type: "application/pdf",
            file_size: 3,
          },
        },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "message",
      message: {
        text: "please read",
        attachments: [
          {
            attachmentId: "pdf-unique-id",
            kind: "document",
            disposition: "attachment",
            filename: "brief.pdf",
            mimeType: "application/pdf",
            sizeBytes: 3,
            adapterData: {
              telegramChatId: "12345",
              telegramMessageId: 777,
              telegramFileId: "pdf-file-id",
              telegramFileUniqueId: "pdf-unique-id",
              updateId: 888,
            },
          },
        ],
      },
    });

    const event = events[0] as {
      readonly message: {
        readonly attachments: readonly [
          { open(input?: { readonly maxBytes?: number }): Promise<{ isOk(): boolean }> },
        ];
      };
    };
    expect(bot.getFileMock).not.toHaveBeenCalled();
    expect(bot.downloadFileMock).not.toHaveBeenCalled();

    const openedAttachment = await event.message.attachments[0].open({ maxBytes: 100 });
    expect(openedAttachment.isOk()).toBe(true);
    expect(bot.getFileMock).toHaveBeenCalledWith({ fileId: "pdf-file-id", signal: undefined });
    expect(bot.downloadFileMock).toHaveBeenCalledWith({
      filePath: "documents/pdf-file-id",
      signal: undefined,
    });
  });

  test("photo updates emit the largest photo as an image attachment", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitMessage(
      createTelegramMessageContext({
        chatId: 12345,
        messageId: 777,
        updateId: 888,
        from: { id: 42, is_bot: false, first_name: "Alice" },
        message: {
          photo: [
            { file_id: "small", file_unique_id: "small-unique", width: 10, height: 10 },
            { file_id: "large", file_unique_id: "large-unique", width: 100, height: 100 },
          ],
        },
      }),
    );

    expect(events[0]).toMatchObject({
      type: "message",
      message: {
        text: "",
        attachments: [
          {
            attachmentId: "large-unique",
            kind: "image",
            disposition: "inline",
            mimeType: "image/jpeg",
            adapterData: { telegramFileId: "large" },
          },
        ],
      },
    });
  });

  test("attachment open rejects known oversized files before download", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitMessage(
      createTelegramMessageContext({
        message: {
          document: {
            file_id: "big-file-id",
            file_unique_id: "big-unique-id",
            file_name: "big.pdf",
            mime_type: "application/pdf",
            file_size: 5_000,
          },
        },
      }),
    );

    const event = events[0] as {
      readonly message: {
        readonly attachments: readonly [
          { open(input?: { readonly maxBytes?: number }): Promise<{ isErr(): boolean }> },
        ];
      };
    };
    const openedAttachment = await event.message.attachments[0].open({ maxBytes: 100 });
    expect(openedAttachment.isErr()).toBe(true);
    expect(bot.getFileMock).not.toHaveBeenCalled();
    expect(bot.downloadFileMock).not.toHaveBeenCalled();
  });

  test("bot and system text authors are normalized", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "bot helper",
        from: {
          id: 321,
          is_bot: true,
          first_name: "HelperBot",
          username: "HelperBot",
        },
      }),
    );
    await bot.emitTextMessage(createTelegramTextContext({ text: "system notice" }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      message: {
        actor: {
          kind: "bot",
          actorId: "321",
          displayName: "HelperBot",
        },
      },
    });
    expect(events[1]).toMatchObject({
      message: {
        actor: {
          kind: "system",
          actorId: "-100",
          displayName: "Alice",
        },
      },
    });
  });

  test("slash commands emit normalized command events", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const commands = defineChatCommands({
      start: defineChatCommand({
        description: "Start session",
        options: {
          cwd: stringOption({ required: true }),
          harness: stringOption({ choices: ["opencode", "pi"] as const }),
          retries: numberOption({ required: false }),
          dryRun: booleanOption({ required: false }),
        },
      }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, events }),
    );
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "/start@xmux_bot --cwd '/tmp/my project' --harness pi --retries 2 --dryRun",
        entities: [{ type: "bot_command", offset: 0, length: "/start@xmux_bot".length }],
        from: {
          id: 42,
          is_bot: false,
          first_name: "Alice",
        },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "command",
      chatId: "telegram",
      conversation: { conversationId: "-100" },
      message: { messageId: "10" },
      command: {
        name: "start",
        options: {
          cwd: "/tmp/my project",
          harness: "pi",
          retries: 2,
          dryRun: true,
        },
      },
    });
  });

  test("single string command options accept Telegram-style positional text", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const commands = defineChatCommands({
      echo: defineChatCommand({
        description: "Echo text",
        options: {
          text: stringOption({ required: true }),
        },
      }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, events }),
    );
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "/echo hello from telegram",
        entities: [{ type: "bot_command", offset: 0, length: "/echo".length }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "command",
      command: {
        name: "echo",
        options: { text: "hello from telegram" },
      },
    });
  });

  test("slash commands for other bots stay normal messages", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const commands = defineChatCommands({
      start: defineChatCommand({ description: "Start session" }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, events }),
    );
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "/start@other_bot",
        entities: [{ type: "bot_command", offset: 0, length: "/start@other_bot".length }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message", message: { text: "/start@other_bot" } });
  });

  test("unknown slash commands emit unknown command events", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const commands = defineChatCommands({
      start: defineChatCommand({ description: "Start session" }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, events }),
    );
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "/jfkdlfjd",
        entities: [{ type: "bot_command", offset: 0, length: "/jfkdlfjd".length }],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "command.unknown", commandName: "jfkdlfjd" });
  });

  test("invalid slash command options emit diagnostics and invalid command events", async () => {
    const bot = createFakeTelegramBot();
    const diagnostics: string[] = [];
    const events: unknown[] = [];
    const commands = defineChatCommands({
      start: defineChatCommand({
        description: "Start session",
        options: {
          harness: stringOption({ required: true, choices: ["opencode", "pi"] as const }),
        },
      }),
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(
      createStartContext({ chatId: "telegram", commands, diagnostics, events }),
    );
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "/start --harness bad",
        entities: [{ type: "bot_command", offset: 0, length: "/start".length }],
      }),
    );

    expect(diagnostics).toContain("COMMAND_PARSE_FAILED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "command.invalid",
      commandName: "start",
      optionName: "harness",
      reason: "value must be one of: opencode, pi",
    });
  });

  test("text updates from the current bot are ignored", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const started = await opened.value.start(createStartContext({ chatId: "telegram", events }));
    expect(started.isOk()).toBe(true);

    await bot.emitTextMessage(
      createTelegramTextContext({
        text: "echo",
        botId: 999,
        from: {
          id: 999,
          is_bot: true,
          first_name: "ThisBot",
          username: "ThisBot",
        },
      }),
    );

    expect(events).toEqual([]);
  });

  test("sendAction sends Telegram inline keyboard buttons", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendAction({
      chatId: "telegram",
      conversationId: "42",
      text: "Deploy?",
      format: "markdown",
      buttons: [
        [
          {
            id: "approve",
            label: "Approve",
            actionId: "d",
            value: "a",
            payload: { id: "1" },
          },
          { kind: "url", id: "docs", label: "Docs", url: "https://example.com" },
        ],
      ],
      adapterOptions: {},
    });

    expect(sent.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "42",
        text: "Deploy?",
        options: expect.objectContaining({
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Approve",
                  callback_data: '{"actionId":"d","value":"a","payload":{"id":"1"}}',
                },
                { text: "Docs", url: "https://example.com" },
              ],
            ],
          },
        }),
      }),
    );
  });

  test("respondToAction acknowledges, replies, and updates Telegram actions", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const base = {
      chatId: "telegram" as const,
      conversationId: "42",
      interactionId: "callback-1",
      message: { chatId: "telegram" as const, conversationId: "42", messageId: "123" },
      adapterOptions: {},
    };

    expect(
      (await opened.value.respondToAction({ ...base, response: { kind: "ack" } })).isOk(),
    ).toBe(true);
    expect(
      (
        await opened.value.respondToAction({
          ...base,
          response: { kind: "reply", message: "Done" },
        })
      ).isOk(),
    ).toBe(true);
    expect(
      (
        await opened.value.respondToAction({
          ...base,
          response: { kind: "update", message: "Approved", buttons: [] },
        })
      ).isOk(),
    ).toBe(true);

    expect(bot.answerCallbackQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ callbackQueryId: "callback-1" }),
    );
    expect(bot.sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "42", text: "Done" }),
    );
    expect(bot.editMessageTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "42", messageId: 123, text: "Approved" }),
    );
  });

  test("callback query data emits normalized action events", async () => {
    const bot = createFakeTelegramBot();
    const events: unknown[] = [];
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    await opened.value.start(createStartContext({ chatId: "telegram", events }));
    await bot.emitCallbackQueryData({
      callbackQuery: {
        id: "callback-1",
        data: '{"actionId":"deployment","value":"approve","payload":{"deploymentId":"dep1"}}',
        message: { message_id: 123, chat: { id: 42, type: "private", first_name: "Alice" } },
      },
      chat: { id: 42, type: "private", first_name: "Alice" },
      from: { id: 7, is_bot: false, first_name: "Bob" },
      update: { update_id: 99 },
    } as unknown as TelegramCallbackQueryDataContext);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action",
        chatId: "telegram",
        interactionId: "callback-1",
        actionId: "deployment",
        value: "approve",
        payload: { deploymentId: "dep1" },
      }),
    );
  });

  test("sendMessage sends text with format and adapter options", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendMessage({
      chatId: "telegram",
      conversationId: "12345",
      text: "**hello** from hello_world",
      format: "markdown",
      adapterOptions: { disable_notification: true },
    });

    expect(sent.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "*hello* from hello\\_world",
      options: {
        parse_mode: "MarkdownV2",
        disable_notification: true,
      },
      signal: undefined,
    });
    if (sent.isOk()) {
      expect(sent.value).toMatchObject({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "123",
        text: "**hello** from hello_world",
        format: "markdown",
        adapterData: {
          telegramChatId: "12345",
          telegramMessageId: 123,
        },
      });
    }
  });

  test("sendMessage lets adapter options override default parse mode", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendMessage({
      chatId: "telegram",
      conversationId: "12345",
      text: "<b>hello</b>",
      format: "html",
      adapterOptions: { parse_mode: "Markdown" },
    });

    expect(sent.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "<b>hello</b>",
      options: { parse_mode: "Markdown" },
      signal: undefined,
    });
  });

  test("sendMessage lets adapter parse mode override markdown conversion", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendMessage({
      chatId: "telegram",
      conversationId: "12345",
      text: "**hello**",
      format: "markdown",
      adapterOptions: { parse_mode: "Markdown" },
    });

    expect(sent.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "**hello**",
      options: { parse_mode: "Markdown" },
      signal: undefined,
    });
  });

  test("sendMessage returns typed Telegram send failures", async () => {
    const bot = createFakeTelegramBot({ sendMessageError: new Error("send failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendMessage({
      chatId: "telegram",
      conversationId: "12345",
      text: "hello",
      adapterOptions: {},
    });

    expect(sent.isErr()).toBe(true);
    if (sent.isErr()) {
      expect(sent.error).toBeInstanceOf(TelegramSendMessageError);
      if (TelegramSendMessageError.is(sent.error)) {
        expect(sent.error.message).toContain("send failed");
      }
    }
  });

  test("sendTyping sends a Telegram typing chat action", async () => {
    const bot = createFakeTelegramBot();
    const abortController = new AbortController();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendTyping?.({
      chatId: "telegram",
      conversationId: "12345",
      action: "typing",
      adapterOptions: { message_thread_id: 9, parse_mode: "Markdown" },
      signal: abortController.signal,
    });

    expect(sent?.isOk()).toBe(true);
    expect(bot.sendChatActionMock).toHaveBeenCalledWith({
      chatId: "12345",
      action: "typing",
      options: { message_thread_id: 9 },
      signal: abortController.signal,
    });
  });

  test("sendTyping returns typed Telegram typing failures", async () => {
    const bot = createFakeTelegramBot({ sendChatActionError: new Error("typing failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const sent = await opened.value.sendTyping?.({
      chatId: "telegram",
      conversationId: "12345",
      action: "typing",
      adapterOptions: {},
    });

    expect(sent?.isErr()).toBe(true);
    if (sent?.isErr()) {
      expect(sent.error).toBeInstanceOf(TelegramSendTypingError);
      if (TelegramSendTypingError.is(sent.error)) {
        expect(sent.error.message).toContain("typing failed");
      }
    }
  });

  test("streamMessage uses grammY stream drafts for non-markdown streams", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["hel", "lo"]) },
      adapterOptions: { disable_notification: true },
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        messageOptions: { disable_notification: true },
      }),
    );
    expect(bot.editMessageTextMock).not.toHaveBeenCalled();
    if (streamed.isOk()) {
      expect(streamed.value).toMatchObject({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "124",
        text: "hello",
        adapterData: {
          telegramChatId: "12345",
          telegramMessageId: 124,
        },
      });
    }
  });

  test("streamMessage streams rendered markdown with entities", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["**hel", "lo** from hello_world"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).not.toHaveBeenCalled();
    expect(bot.sendMessageDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        text: "hel",
        options: { entities: [{ type: "bold", offset: 0, length: 3 }] },
      }),
    );
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: 12345,
      text: "hello from hello_world",
      options: { entities: [{ type: "bold", offset: 0, length: 5 }] },
      signal: undefined,
    });
    expect(bot.editMessageTextMock).not.toHaveBeenCalled();
    if (streamed.isOk()) {
      expect(streamed.value.text).toBe("**hello** from hello_world");
      expect(streamed.value.format).toBe("markdown");
    }
  });

  test("streamMessage omits empty entities for plain rendered markdown", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["plain response"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.sendMessageDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "plain response",
        options: {},
      }),
    );
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: 12345,
      text: "plain response",
      options: {},
      signal: undefined,
    });
  });

  test("streamMessage refreshes the live markdown draft while waiting for chunks", async () => {
    vi.useFakeTimers();
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    const nextChunk = createDeferred();
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      vi.useRealTimers();
      return;
    }

    async function* chunks() {
      yield { type: "delta" as const, delta: "waiting" };
      await nextChunk.promise;
      yield { type: "delta" as const, delta: " done" };
    }

    try {
      const streamed = opened.value.streamMessage({
        chatId: "telegram",
        conversationId: "12345",
        content: { chunks: chunks(), format: "markdown" },
        adapterOptions: {},
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(bot.sendMessageDraftMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4_000);
      expect(bot.sendMessageDraftMock).toHaveBeenCalledTimes(2);
      expect(bot.sendMessageDraftMock.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ text: "waiting" }),
      );

      nextChunk.resolve();
      const result = await streamed;
      expect(result.isOk()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("streamMessage still sends final output if Telegram drafts fail", async () => {
    const bot = createFakeTelegramBot({ sendMessageDraftError: new Error("draft failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["plain response"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: 12345,
      text: "plain response",
      options: {},
      signal: undefined,
    });
  });

  test("streamMessage returns typed markdown path send failures", async () => {
    const bot = createFakeTelegramBot({ sendMessageError: new Error("send failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["plain response"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(TelegramStreamMessageError);
      if (TelegramStreamMessageError.is(streamed.error)) {
        expect(streamed.error.message).toContain("send failed");
      }
    }
  });

  test("streamMessage honors aborts on the rendered markdown path", async () => {
    const bot = createFakeTelegramBot();
    const abortController = new AbortController();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    async function* chunks() {
      yield { type: "delta" as const, delta: "before abort" };
      abortController.abort(new Error("aborted"));
      yield { type: "delta" as const, delta: " after abort" };
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: chunks(), format: "markdown" },
      adapterOptions: {},
      signal: abortController.signal,
    });

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(TelegramStreamMessageError);
    }
    expect(bot.sendMessageMock).not.toHaveBeenCalled();
  });

  test("streamMessage keeps Telegram-owned parse mode on the native stream path", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["**hel", "lo**"]), format: "markdown" },
      adapterOptions: { parse_mode: "Markdown" },
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        draftOptions: { parse_mode: "Markdown" },
        messageOptions: { parse_mode: "Markdown" },
      }),
    );
    expect(bot.sendMessageDraftMock).not.toHaveBeenCalled();
  });

  test("streamMessage sends long rendered markdown as multiple messages", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks([`**${"a".repeat(5_000)}**`]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).not.toHaveBeenCalled();
    expect(bot.sendMessageMock).toHaveBeenCalledTimes(2);
    const calls = bot.sendMessageMock.mock.calls.map((call) => call[0]);
    expect(calls[0].text).toHaveLength(4_096);
    expect(calls[0].options.entities).toEqual([{ type: "bold", offset: 0, length: 4_096 }]);
    expect(calls[1].text).toHaveLength(904);
    expect(calls[1].options.entities).toEqual([{ type: "bold", offset: 0, length: 904 }]);
    if (streamed.isOk()) {
      expect(streamed.value.text).toBe(`**${"a".repeat(5_000)}**`);
      expect(streamed.value.messageId).toBe("124");
    }
  });

  test("streamMessage edits provisional segments during final markdown reconciliation", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const label = "a".repeat(4_100);
    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks([`[${label}](`, "https://example.com)"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.editMessageTextMock).toHaveBeenCalledWith({
      chatId: 12345,
      messageId: 123,
      text: label.slice(0, 4_096),
      options: {
        entities: [{ type: "text_link", offset: 0, length: 4_096, url: "https://example.com" }],
      },
      signal: undefined,
    });
    expect(bot.sendMessageMock).toHaveBeenCalledTimes(2);
  });

  test("streamMessage ignores Telegram message-not-modified errors during final reconciliation", async () => {
    const bot = createFakeTelegramBot({
      editMessageTextError: {
        error_code: 400,
        description:
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
      },
    });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const label = "a".repeat(4_100);
    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks([`[${label}](`, "https://example.com)"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.editMessageTextMock).toHaveBeenCalledOnce();
    expect(bot.sendMessageMock).toHaveBeenCalledTimes(2);
    if (streamed.isOk()) {
      expect(streamed.value.messageId).toBe("124");
    }
  });

  test("streamMessage rejects non-numeric conversations", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamMessage({
      chatId: "telegram",
      conversationId: "@channel",
      content: { chunks: textChunks(["hello"]) },
      adapterOptions: {},
    });

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(TelegramStreamMessageError);
    }
    expect(bot.streamMessageMock).not.toHaveBeenCalled();
  });

  test("streamReply uses grammY stream drafts with reply parameters", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamReply({
      chatId: "telegram",
      conversationId: "12345",
      message: { chatId: "telegram", conversationId: "12345", messageId: "777" },
      content: { chunks: textChunks(["reply ", "stream"]) },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        messageOptions: { reply_parameters: { message_id: 777 } },
      }),
    );
    if (streamed.isOk()) {
      expect(streamed.value).toMatchObject({
        chatId: "telegram",
        conversationId: "12345",
        messageId: "124",
        text: "reply stream",
      });
    }
  });

  test("streamReply streams rendered markdown with reply parameters", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamReply({
      chatId: "telegram",
      conversationId: "12345",
      message: { chatId: "telegram", conversationId: "12345", messageId: "777" },
      content: { chunks: textChunks(["reply **", "ok**"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isOk()).toBe(true);
    expect(bot.streamMessageMock).not.toHaveBeenCalled();
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: 12345,
      text: "reply ok",
      options: {
        reply_parameters: { message_id: 777 },
        entities: [{ type: "bold", offset: 6, length: 2 }],
      },
      signal: undefined,
    });
    expect(bot.editMessageTextMock).not.toHaveBeenCalled();
    if (streamed.isOk()) {
      expect(streamed.value.text).toBe("reply **ok**");
      expect(streamed.value.format).toBe("markdown");
    }
  });

  test("streamReply returns typed markdown path send failures", async () => {
    const bot = createFakeTelegramBot({ sendMessageError: new Error("reply send failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamReply({
      chatId: "telegram",
      conversationId: "12345",
      message: { chatId: "telegram", conversationId: "12345", messageId: "777" },
      content: { chunks: textChunks(["reply"]), format: "markdown" },
      adapterOptions: {},
    });

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(TelegramStreamReplyError);
      if (TelegramStreamReplyError.is(streamed.error)) {
        expect(streamed.error.message).toContain("reply send failed");
      }
    }
  });

  test("streamReply rejects strict quote replies without message ids", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const streamed = await opened.value.streamReply({
      chatId: "telegram",
      conversationId: "12345",
      content: { chunks: textChunks(["reply stream"]) },
      mode: "quote",
      adapterOptions: {},
    });

    expect(streamed.isErr()).toBe(true);
    if (streamed.isErr()) {
      expect(streamed.error).toBeInstanceOf(TelegramStreamReplyError);
    }
    expect(bot.streamMessageMock).not.toHaveBeenCalled();
  });

  test("reply auto uses Telegram reply parameters and markdown conversion", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const replied = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      message: { chatId: "telegram", conversationId: "12345", messageId: "777" },
      text: "reply **ok** for hello_world",
      format: "markdown",
      adapterOptions: {},
    });

    expect(replied.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "reply *ok* for hello\\_world",
      options: { reply_parameters: { message_id: 777 }, parse_mode: "MarkdownV2" },
      signal: undefined,
    });
  });

  test("reply conversation sends a normal message", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const replied = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      message: { chatId: "telegram", conversationId: "12345", messageId: "777" },
      text: "normal",
      mode: "conversation",
      adapterOptions: {},
    });

    expect(replied.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "normal",
      options: {},
      signal: undefined,
    });
  });

  test("reply strict quote rejects missing message ids", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const replied = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      text: "quote",
      mode: "quote",
      adapterOptions: {},
    });

    expect(replied.isErr()).toBe(true);
    if (replied.isErr()) {
      expect(replied.error).toBeInstanceOf(TelegramReplyError);
      expect(bot.sendMessageMock).not.toHaveBeenCalled();
    }
  });

  test("reply thread requires message_thread_id", async () => {
    const bot = createFakeTelegramBot();
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const missingThread = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      text: "thread",
      mode: "thread",
      adapterOptions: {},
    });
    expect(missingThread.isErr()).toBe(true);

    const replied = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      text: "thread",
      mode: "thread",
      adapterOptions: { message_thread_id: 9 },
    });
    expect(replied.isOk()).toBe(true);
    expect(bot.sendMessageMock).toHaveBeenCalledWith({
      chatId: "12345",
      text: "thread",
      options: { message_thread_id: 9 },
      signal: undefined,
    });
  });

  test("reply returns typed Telegram reply failures", async () => {
    const bot = createFakeTelegramBot({ sendMessageError: new Error("reply failed") });
    const opened = createRuntimeWithFakeBot({ bot });
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    const replied = await opened.value.reply!({
      chatId: "telegram",
      conversationId: "12345",
      text: "reply",
      adapterOptions: {},
    });

    expect(replied.isErr()).toBe(true);
    if (replied.isErr()) {
      expect(replied.error).toBeInstanceOf(TelegramReplyError);
      if (TelegramReplyError.is(replied.error)) {
        expect(replied.error.message).toContain("reply failed");
      }
    }
  });

  test("close is safe to call more than once", async () => {
    const adapter = createTelegramAdapter({ token: "123:test" });
    const opened = await adapter.open({});
    expect(opened.isOk()).toBe(true);
    if (opened.isErr()) {
      return;
    }

    await expect(opened.value.close()).resolves.toBeUndefined();
    await expect(opened.value.close()).resolves.toBeUndefined();
  });
});
