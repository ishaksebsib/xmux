import { Result } from "better-result";
import type {
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatSentMessage,
} from "@xmux/chat-core";
import type { TelegramBotClient, TelegramSentTextMessage } from "../client";
import { TelegramReplyError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";
import { parseTelegramMessageId as parseRawTelegramMessageId } from "../utils";
import { encodeTelegramFormattedText, encodeTelegramFormatOptions } from "./formatting";

declare const telegramMessageIdBrand: unique symbol;

type TelegramMessageId = number & { readonly [telegramMessageIdBrand]: true };
type TelegramBotSendMessageArgs = Parameters<TelegramBotClient["sendMessage"]>[0];
type TelegramBotSendChatActionArgs = Parameters<TelegramBotClient["sendChatAction"]>[0];

export type TelegramSendMessageRequest = Omit<TelegramBotSendMessageArgs, "signal">;
export type TelegramSendTypingRequest = Omit<TelegramBotSendChatActionArgs, "signal">;

export function encodeTelegramSendMessage(
  input: ChatAdapterSendMessageInput<string, TelegramAdapterOptions>,
): TelegramSendMessageRequest {
  const formattedText = encodeTelegramFormattedText({
    text: input.text,
    format: input.format,
    adapterOptions: input.adapterOptions,
  });

  return {
    chatId: input.conversationId,
    text: formattedText.text,
    options: {
      ...formattedText.options,
      ...input.adapterOptions,
    },
  };
}

export function encodeTelegramReplyMessage(
  input: ChatAdapterReplyInput<string, TelegramAdapterOptions>,
): Result<TelegramSendMessageRequest, TelegramReplyError> {
  const options = encodeTelegramReplyMessageOptions(input);
  if (options.isErr()) {
    return Result.err(options.error);
  }

  const formattedText = encodeTelegramFormattedText({
    text: input.text,
    format: input.format,
    adapterOptions: input.adapterOptions,
  });

  return Result.ok({
    chatId: input.conversationId,
    text: formattedText.text,
    options: options.value,
  });
}

export function encodeTelegramSendTyping(
  input: ChatAdapterSendTypingInput<string, TelegramAdapterOptions>,
): TelegramSendTypingRequest {
  return {
    chatId: input.conversationId,
    action: input.action,
    options: encodeTelegramSendTypingOptions(input.adapterOptions),
  };
}

export function encodeTelegramSentMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly text: string;
  readonly format: ChatAdapterSendMessageInput<TChatId, TelegramAdapterOptions>["format"];
  readonly telegramMessage: TelegramSentTextMessage;
}): ChatSentMessage<TChatId, TelegramAdapterData> {
  return {
    chatId: args.chatId,
    conversationId: args.conversationId,
    messageId: String(args.telegramMessage.message_id),
    text: args.text,
    format: args.format,
    adapterData: {
      telegramChatId: String(args.telegramMessage.chat.id),
      telegramMessageId: args.telegramMessage.message_id,
      raw: args.telegramMessage,
    },
  };
}

function encodeTelegramSendTypingOptions(
  adapterOptions: TelegramAdapterOptions,
): TelegramSendTypingRequest["options"] {
  const options = {
    ...("business_connection_id" in adapterOptions
      ? { business_connection_id: adapterOptions.business_connection_id }
      : {}),
    ...("message_thread_id" in adapterOptions
      ? { message_thread_id: adapterOptions.message_thread_id }
      : {}),
  } satisfies NonNullable<TelegramSendTypingRequest["options"]>;

  return Object.keys(options).length === 0 ? undefined : options;
}

function encodeTelegramSendMessageOptions(
  input: ChatAdapterSendMessageInput<string, TelegramAdapterOptions>,
): TelegramAdapterOptions {
  return {
    ...encodeTelegramFormatOptions(input.format),
    ...input.adapterOptions,
  };
}

function encodeTelegramReplyMessageOptions(
  input: ChatAdapterReplyInput<string, TelegramAdapterOptions>,
): Result<TelegramAdapterOptions, TelegramReplyError> {
  const baseOptions = encodeTelegramSendMessageOptions(input);
  const mode = input.mode ?? "auto";

  if (mode === "conversation") {
    return Result.ok(baseOptions);
  }

  if (mode === "thread") {
    return "message_thread_id" in baseOptions
      ? Result.ok(baseOptions)
      : Result.err(
          new TelegramReplyError({
            reason: "Telegram thread replies require adapterOptions.message_thread_id",
          }),
        );
  }

  const messageId = input.message?.messageId;
  if (messageId === undefined) {
    return mode === "auto"
      ? Result.ok(baseOptions)
      : Result.err(
          new TelegramReplyError({ reason: "Telegram quote replies require a message id" }),
        );
  }

  const parsedMessageId = parseTelegramMessageId(messageId);
  if (parsedMessageId.isErr()) {
    return mode === "auto" ? Result.ok(baseOptions) : Result.err(parsedMessageId.error);
  }

  return Result.ok({
    ...encodeTelegramReplyParameters(parsedMessageId.value),
    ...baseOptions,
  });
}

function encodeTelegramReplyParameters(messageId: TelegramMessageId): TelegramAdapterOptions {
  return {
    reply_parameters: {
      message_id: messageId,
    },
  };
}

function parseTelegramMessageId(messageId: string): Result<TelegramMessageId, TelegramReplyError> {
  const parsed = parseRawTelegramMessageId(messageId);
  return parsed === undefined
    ? Result.err(
        new TelegramReplyError({
          reason: `Telegram message id must be a positive integer: ${messageId}`,
        }),
      )
    : Result.ok(parsed as TelegramMessageId);
}
