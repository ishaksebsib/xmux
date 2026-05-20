import type { MessageDraftPiece } from "@grammyjs/stream";
import { Result } from "better-result";
import type {
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatSentMessage,
  ChatTextStreamChunk,
} from "@xmux/chat-core";
import { TelegramStreamReplyError } from "../errors";
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
  return createTelegramStreamMessageRequest({
    conversationId: input.conversationId,
    chunks: input.content.chunks,
    format: input.content.format,
    adapterOptions: input.adapterOptions,
  });
}

export function encodeTelegramStreamReplyMessage(
  input: ChatAdapterStreamReplyInput<string, TelegramAdapterOptions>,
): Result<TelegramStreamMessageRequest, TelegramStreamReplyError> {
  const baseRequest = createTelegramStreamMessageRequest({
    conversationId: input.conversationId,
    chunks: input.content.chunks,
    format: input.content.format,
    adapterOptions: input.adapterOptions,
  });
  const mode = input.mode ?? "auto";

  if (mode === "conversation") {
    return Result.ok(baseRequest);
  }

  if (mode === "thread") {
    return input.adapterOptions.message_thread_id === undefined
      ? Result.err(
          new TelegramStreamReplyError({
            reason: "Telegram thread stream replies require adapterOptions.message_thread_id",
          }),
        )
      : Result.ok(baseRequest);
  }

  const messageId = input.message?.messageId;
  if (messageId === undefined) {
    return mode === "auto"
      ? Result.ok(baseRequest)
      : Result.err(
          new TelegramStreamReplyError({
            reason: "Telegram quote stream replies require a message id",
          }),
        );
  }

  const parsedMessageId = parseTelegramMessageId(messageId);
  if (parsedMessageId === undefined) {
    return mode === "auto"
      ? Result.ok(baseRequest)
      : Result.err(
          new TelegramStreamReplyError({
            reason: `Telegram message id must be a positive integer: ${messageId}`,
          }),
        );
  }

  return Result.ok({
    ...baseRequest,
    messageOptions: {
      reply_parameters: { message_id: parsedMessageId },
      ...baseRequest.messageOptions,
    },
  });
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

function createTelegramStreamMessageRequest(args: {
  readonly conversationId: string;
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): TelegramStreamMessageRequest {
  return {
    chatId: Number(args.conversationId),
    draftIdOffset: createTelegramDraftIdOffset(),
    stream: encodeTelegramMessageDraftPieces(args.chunks),
    draftOptions: encodeTelegramMessageDraftOptions({
      format: args.format,
      adapterOptions: args.adapterOptions,
    }),
    messageOptions: {
      ...encodeTelegramFormatOptions(args.format),
      ...args.adapterOptions,
    },
  };
}

function encodeTelegramMessageDraftOptions(args: {
  readonly format: ChatAdapterStreamMessageInput<string, TelegramAdapterOptions>["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): TelegramStreamMessageRequest["draftOptions"] {
  const options = {
    ...encodeTelegramFormatOptions(args.format),
    ...(args.adapterOptions.message_thread_id === undefined
      ? {}
      : { message_thread_id: args.adapterOptions.message_thread_id }),
    ...(args.adapterOptions.parse_mode === undefined
      ? {}
      : { parse_mode: args.adapterOptions.parse_mode }),
  } satisfies TelegramStreamMessageRequest["draftOptions"];

  return Object.keys(options).length === 0 ? undefined : options;
}

function parseTelegramMessageId(messageId: string): number | undefined {
  const parsed = Number(messageId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createTelegramDraftIdOffset(): number {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}
