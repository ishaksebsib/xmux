import type { MessageDraftPiece } from "@grammyjs/stream";
import type {
  ChatAdapterStreamMessageInput,
  ChatSentMessage,
  ChatTextStreamChunk,
} from "@xmux/chat-core";
import type { TelegramStreamedTextMessages } from "../client";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export type TelegramStreamMessageRequest = {
  readonly chatId: number;
  readonly draftIdOffset: number;
  readonly stream: AsyncIterable<MessageDraftPiece>;
  readonly draftOptions?: {
    readonly message_thread_id?: number;
    readonly parse_mode?: TelegramAdapterOptions["parse_mode"];
  };
  readonly messageOptions?: TelegramAdapterOptions;
};

export function encodeTelegramStreamMessage(
  input: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>,
): TelegramStreamMessageRequest {
  return {
    chatId: Number(input.conversationId),
    draftIdOffset: createTelegramDraftIdOffset(),
    stream: encodeTelegramMessageDraftPieces(input.content.chunks),
    draftOptions: encodeTelegramMessageDraftOptions(input),
    messageOptions: {
      ...encodeTelegramFormatOptions(input.content.format),
      ...input.adapterOptions,
    },
  };
}

export function encodeTelegramStreamedMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly text: string;
  readonly format: ChatAdapterStreamMessageInput<TChatId, TelegramAdapterOptions>["content"]["format"];
  readonly telegramMessages: TelegramStreamedTextMessages;
}): ChatSentMessage<TChatId, TelegramAdapterData> {
  const lastMessage = args.telegramMessages.at(-1);
  if (lastMessage === undefined) {
    throw new Error("Telegram stream did not send any messages");
  }

  return {
    chatId: args.chatId,
    conversationId: args.conversationId,
    messageId: String(lastMessage.message_id),
    text: args.text,
    format: args.format,
    adapterData: {
      telegramChatId: String(lastMessage.chat.id),
      telegramMessageId: lastMessage.message_id,
      raw: args.telegramMessages,
    },
  };
}

export function parseTelegramPrivateChatId(conversationId: string): number | undefined {
  const chatId = Number(conversationId);
  return Number.isInteger(chatId) && chatId > 0 ? chatId : undefined;
}

export function encodeTelegramFormatOptions(
  format: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>["content"]["format"],
): TelegramAdapterOptions {
  if (format === "html") {
    return { parse_mode: "HTML" };
  }

  if (format === "markdown") {
    return { parse_mode: "MarkdownV2" };
  }

  return {};
}

async function* encodeTelegramMessageDraftPieces(
  chunks: AsyncIterable<ChatTextStreamChunk>,
): AsyncIterable<MessageDraftPiece> {
  let text = "";

  for await (const chunk of chunks) {
    if (chunk.type === "delta") {
      text += chunk.delta;
      yield chunk.delta;
      continue;
    }

    const nextText = chunk.text;
    if (nextText === undefined) {
      continue;
    }

    if (!nextText.startsWith(text)) {
      throw new Error("Telegram native streaming only supports append-only text snapshots");
    }

    const delta = nextText.slice(text.length);
    text = nextText;
    if (delta.length > 0) {
      yield delta;
    }
  }
}

function encodeTelegramMessageDraftOptions(
  input: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>,
): TelegramStreamMessageRequest["draftOptions"] {
  const options = {
    ...encodeTelegramFormatOptions(input.content.format),
    ...(input.adapterOptions.message_thread_id === undefined
      ? {}
      : { message_thread_id: input.adapterOptions.message_thread_id }),
    ...(input.adapterOptions.parse_mode === undefined
      ? {}
      : { parse_mode: input.adapterOptions.parse_mode }),
  } satisfies TelegramStreamMessageRequest["draftOptions"];

  return Object.keys(options).length === 0 ? undefined : options;
}

function createTelegramDraftIdOffset(): number {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}
