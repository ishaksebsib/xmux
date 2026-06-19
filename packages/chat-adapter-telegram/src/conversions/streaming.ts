import { Result } from "better-result";
import type {
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
  ChatMessageFormat,
  ChatSentMessage,
  ChatTextStreamChunk,
} from "@xmux/chat-core";
import type { TelegramBotClient, TelegramStreamedMessage } from "../client";
import { TelegramStreamReplyError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";
import { encodeTelegramFormatOptions } from "./formatting";

type TelegramPlainStreamArgs = Parameters<TelegramBotClient["streamMessage"]>[0];
type TelegramRichDraftOptions = Parameters<TelegramBotClient["sendRichMessageDraft"]>[0]["options"];
type TelegramRichMessageOptions = Parameters<TelegramBotClient["sendRichMessage"]>[0]["options"];
type TelegramRichBaseInputMessage = Omit<
  Parameters<TelegramBotClient["sendRichMessage"]>[0]["richMessage"],
  "markdown" | "html"
>;

type TelegramRichStreamFormat = Extract<ChatMessageFormat, "markdown" | "html">;

export type TelegramPlainStreamMessageRequest = {
  readonly kind: "plain";
  readonly chatId: number;
  readonly draftIdOffset: number;
  readonly stream: AsyncIterable<string>;
  readonly draftOptions?: TelegramPlainStreamArgs["draftOptions"];
  readonly messageOptions?: TelegramPlainStreamArgs["messageOptions"];
};

export type TelegramRichStreamMessageRequest = {
  readonly kind: "rich";
  readonly format: TelegramRichStreamFormat;
  readonly chatId: number;
  readonly draftId: number;
  readonly stream: AsyncIterable<string>;
  readonly draftOptions?: TelegramRichDraftOptions;
  readonly messageOptions?: TelegramRichMessageOptions;
  readonly baseInputRichMessage?: TelegramRichBaseInputMessage;
};

export type TelegramStreamMessageRequest =
  | TelegramPlainStreamMessageRequest
  | TelegramRichStreamMessageRequest;

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

  return Result.ok(
    withTelegramReplyParameters(baseRequest, { reply_parameters: { message_id: parsedMessageId } }),
  );
}

export function encodeTelegramStreamedMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly text: string;
  readonly format: ChatAdapterStreamMessageInput<
    TChatId,
    TelegramAdapterOptions
  >["content"]["format"];
  readonly telegramMessages: TelegramStreamedMessage;
}): ChatSentMessage<TChatId, TelegramAdapterData> {
  const lastMessage = getLastTelegramStreamedMessage(args.telegramMessages);
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

export function shouldUseTelegramRichStream(args: {
  readonly format: ChatAdapterStreamMessageInput<
    string,
    TelegramAdapterOptions
  >["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): boolean {
  return parseTelegramRichStreamFormat(args) !== undefined;
}

function parseTelegramRichStreamFormat(args: {
  readonly format: ChatAdapterStreamMessageInput<
    string,
    TelegramAdapterOptions
  >["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): TelegramRichStreamFormat | undefined {
  if (args.adapterOptions.parse_mode !== undefined || args.adapterOptions.entities !== undefined) {
    return undefined;
  }

  if (args.format === "markdown" || args.format === "html") {
    return args.format;
  }

  return undefined;
}

function createTelegramStreamMessageRequest(args: {
  readonly conversationId: string;
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format: ChatAdapterStreamMessageInput<
    string,
    TelegramAdapterOptions
  >["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): TelegramStreamMessageRequest {
  const richFormat = parseTelegramRichStreamFormat({
    format: args.format,
    adapterOptions: args.adapterOptions,
  });
  if (richFormat !== undefined) {
    return {
      kind: "rich",
      format: richFormat,
      chatId: Number(args.conversationId),
      draftId: createTelegramDraftId(),
      stream: encodeTelegramTextDeltas(args.chunks),
      draftOptions: encodeTelegramRichDraftOptions(args.adapterOptions),
      messageOptions: encodeTelegramRichMessageOptions(args.adapterOptions),
    };
  }

  return {
    kind: "plain",
    chatId: Number(args.conversationId),
    draftIdOffset: createTelegramDraftId(),
    stream: encodeTelegramTextDeltas(args.chunks),
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

async function* encodeTelegramTextDeltas(
  chunks: AsyncIterable<ChatTextStreamChunk>,
): AsyncIterable<string> {
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

function encodeTelegramMessageDraftOptions(args: {
  readonly format: ChatAdapterStreamMessageInput<
    string,
    TelegramAdapterOptions
  >["content"]["format"];
  readonly adapterOptions: TelegramAdapterOptions;
}): TelegramPlainStreamMessageRequest["draftOptions"] {
  const options = {
    ...encodeTelegramFormatOptions(args.format),
    ...(args.adapterOptions.message_thread_id === undefined
      ? {}
      : { message_thread_id: args.adapterOptions.message_thread_id }),
    ...(args.adapterOptions.parse_mode === undefined
      ? {}
      : { parse_mode: args.adapterOptions.parse_mode }),
  } satisfies TelegramPlainStreamMessageRequest["draftOptions"];

  return Object.keys(options).length === 0 ? undefined : options;
}

function encodeTelegramRichDraftOptions(
  adapterOptions: TelegramAdapterOptions,
): TelegramRichDraftOptions {
  return adapterOptions.message_thread_id === undefined
    ? undefined
    : ({ message_thread_id: adapterOptions.message_thread_id } satisfies TelegramRichDraftOptions);
}

function encodeTelegramRichMessageOptions(
  adapterOptions: TelegramAdapterOptions,
): TelegramRichMessageOptions {
  const options = {
    ...(adapterOptions.business_connection_id === undefined
      ? {}
      : { business_connection_id: adapterOptions.business_connection_id }),
    ...(adapterOptions.message_thread_id === undefined
      ? {}
      : { message_thread_id: adapterOptions.message_thread_id }),
    ...(adapterOptions.direct_messages_topic_id === undefined
      ? {}
      : { direct_messages_topic_id: adapterOptions.direct_messages_topic_id }),
    ...(adapterOptions.disable_notification === undefined
      ? {}
      : { disable_notification: adapterOptions.disable_notification }),
    ...(adapterOptions.protect_content === undefined
      ? {}
      : { protect_content: adapterOptions.protect_content }),
    ...(adapterOptions.allow_paid_broadcast === undefined
      ? {}
      : { allow_paid_broadcast: adapterOptions.allow_paid_broadcast }),
    ...(adapterOptions.message_effect_id === undefined
      ? {}
      : { message_effect_id: adapterOptions.message_effect_id }),
    ...(adapterOptions.suggested_post_parameters === undefined
      ? {}
      : { suggested_post_parameters: adapterOptions.suggested_post_parameters }),
    ...(adapterOptions.reply_parameters === undefined
      ? {}
      : { reply_parameters: adapterOptions.reply_parameters }),
    ...(adapterOptions.reply_markup === undefined
      ? {}
      : { reply_markup: adapterOptions.reply_markup }),
  } satisfies TelegramRichMessageOptions;

  return Object.keys(options).length === 0 ? undefined : options;
}

function withTelegramReplyParameters(
  request: TelegramStreamMessageRequest,
  options: Pick<
    NonNullable<TelegramPlainStreamMessageRequest["messageOptions"]>,
    "reply_parameters"
  >,
): TelegramStreamMessageRequest {
  if (request.kind === "rich") {
    return {
      ...request,
      messageOptions: {
        ...options,
        ...request.messageOptions,
      },
    };
  }

  return {
    ...request,
    messageOptions: {
      ...options,
      ...request.messageOptions,
    },
  };
}

function getLastTelegramStreamedMessage(messages: TelegramStreamedMessage) {
  return Array.isArray(messages) ? messages.at(-1) : messages;
}

function parseTelegramMessageId(messageId: string): number | undefined {
  const parsed = Number(messageId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createTelegramDraftId(): number {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}
