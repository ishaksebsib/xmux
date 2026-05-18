import type { ChatActor, ChatAdapterMessageEvent } from "@xmux/chat-core";
import type { TelegramTextMessageContext } from "./client";
import type { TelegramAdapterData } from "./types";

export function createTelegramTextMessageEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramTextMessageContext;
  readonly botUserId: number;
}): ChatAdapterMessageEvent<TChatId, TelegramAdapterData> | undefined {
  const message = args.context.message;
  const chat = message.chat;
  const from = message.from ?? args.context.from;

  if (from?.id === args.botUserId) {
    return undefined;
  }

  const conversation = {
    chatId: args.chatId,
    conversationId: String(chat.id),
  };
  const adapterData = createTelegramAdapterData({
    chatId: chat.id,
    messageId: message.message_id,
    raw: message,
    updateId: args.context.update.update_id,
  });

  return {
    type: "message",
    chatId: args.chatId,
    conversation,
    message: {
      ...conversation,
      messageId: String(message.message_id),
      text: message.text,
      format: "plain",
      actor: createTelegramActor({ chat, from, adapterData }),
      adapterData,
    },
  };
}

function createTelegramAdapterData(args: {
  readonly chatId: number | string;
  readonly messageId?: number;
  readonly raw: unknown;
  readonly updateId?: number;
}): TelegramAdapterData {
  return {
    telegramChatId: String(args.chatId),
    telegramMessageId: args.messageId,
    updateId: args.updateId,
    raw: args.raw,
  };
}

function createTelegramActor(args: {
  readonly chat: TelegramTextMessageContext["message"]["chat"];
  readonly from: TelegramTextMessageContext["from"];
  readonly adapterData: TelegramAdapterData;
}): ChatActor {
  if (args.from === undefined) {
    return {
      kind: "system",
      actorId: String(args.chat.id),
      displayName: formatTelegramChatName(args.chat),
      adapterData: args.adapterData,
    };
  }

  return {
    kind: args.from.is_bot ? "bot" : "user",
    actorId: String(args.from.id),
    displayName: formatTelegramDisplayName(args.from),
    adapterData: args.adapterData,
  };
}

function formatTelegramDisplayName(from: NonNullable<TelegramTextMessageContext["from"]>): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(from.id);
}

function formatTelegramChatName(chat: TelegramTextMessageContext["message"]["chat"]): string | undefined {
  return "title" in chat
    ? chat.title
    : "first_name" in chat
      ? [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username
      : undefined;
}
