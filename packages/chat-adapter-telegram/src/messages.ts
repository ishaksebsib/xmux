import type { ChatActor, ChatAdapterMessageEvent, ChatAdapterObject } from "@xmux/chat-core";
import type { Chat, User } from "grammy/types";
import type { TelegramTextMessageContext } from "./client";
import type { TelegramAdapterData } from "./types";

export function createTelegramTextMessageEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramTextMessageContext;
}): ChatAdapterMessageEvent<TChatId, TelegramAdapterData> | undefined {
  if (isCurrentBotMessage(args.context)) {
    return undefined;
  }

  const message = args.context.message;
  const conversationId = String(message.chat.id);
  const messageId = String(message.message_id);
  const adapterData: TelegramAdapterData = {
    telegramChatId: conversationId,
    telegramMessageId: message.message_id,
    updateId: args.context.update.update_id,
    raw: args.context.update,
  };

  return {
    type: "message",
    chatId: args.chatId,
    conversation: {
      chatId: args.chatId,
      conversationId,
    },
    message: {
      chatId: args.chatId,
      conversationId,
      messageId,
      text: message.text,
      format: "plain",
      actor: createTelegramActor({
        from: message.from,
        senderChat: message.sender_chat,
        fallbackChat: message.chat,
      }),
      adapterData,
    },
  };
}

function isCurrentBotMessage(context: TelegramTextMessageContext): boolean {
  const from = context.message.from;
  return from?.is_bot === true && from.id === context.me.id;
}

function createTelegramActor(args: {
  readonly from?: User;
  readonly senderChat?: Chat;
  readonly fallbackChat: Chat;
}): ChatActor<ChatAdapterObject> {
  if (args.from !== undefined) {
    const displayName = createTelegramUserDisplayName(args.from);
    const actor = {
      kind: args.from.is_bot ? "bot" : "user",
      actorId: String(args.from.id),
      adapterData: { raw: args.from },
    } as const;

    return displayName === undefined ? actor : { ...actor, displayName };
  }

  const chat = args.senderChat ?? args.fallbackChat;
  const displayName = createTelegramChatDisplayName(chat);
  const actor = {
    kind: "system",
    actorId: String(chat.id),
    adapterData: { raw: chat },
  } as const;

  return displayName === undefined ? actor : { ...actor, displayName };
}

function createTelegramUserDisplayName(user: User): string | undefined {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : user.username;
}

function createTelegramChatDisplayName(chat: Chat): string | undefined {
  if ("title" in chat) {
    return chat.title;
  }

  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : chat.username;
}
