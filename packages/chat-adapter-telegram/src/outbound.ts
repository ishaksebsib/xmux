import type { ChatAdapterSendMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramSentTextMessage } from "./client";
import type { TelegramAdapterData, TelegramAdapterOptions } from "./types";

export function createTelegramSendMessageOptions(
  input: ChatAdapterSendMessageInput<string, TelegramAdapterOptions>,
): TelegramAdapterOptions {
  return {
    ...createTelegramFormatOptions(input.format),
    ...input.adapterOptions,
  };
}

export function createTelegramSentMessage<TChatId extends string>(args: {
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

function createTelegramFormatOptions(
  format: ChatAdapterSendMessageInput<string, TelegramAdapterOptions>["format"],
): TelegramAdapterOptions {
  if (format === "html") {
    return { parse_mode: "HTML" };
  }

  if (format === "markdown") {
    return { parse_mode: "MarkdownV2" };
  }

  return {};
}
