import type {
  ChatActor,
  ChatAdapterDiagnosticInput,
  ChatAdapterActionEvent,
  ChatAdapterEvent,
  ChatAdapterMessageEvent,
  ChatCommandRegistry,
} from "@xmux/chat-core";
import type { TelegramCallbackQueryDataContext, TelegramTextMessageContext } from "../client";
import { createTelegramCommandEvent, parseTelegramCommand } from "../commands";
import { decodeTelegramActionCallbackData } from "./actions";
import type { TelegramAdapterData } from "../types";

export type TelegramInboundDecodeResult<TEvent> =
  | { readonly status: "event"; readonly event: TEvent }
  | { readonly status: "ignored"; readonly reason: "self_message" | "unsupported_action" };

export function decodeTelegramTextUpdate<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly commands: TCommands;
  readonly context: TelegramTextMessageContext;
  readonly botUserId: number;
  readonly botUsername: string;
  readonly diagnostic: (diagnostic: ChatAdapterDiagnosticInput<TChatId>) => void;
}): TelegramInboundDecodeResult<
  ChatAdapterEvent<TCommands, TChatId, { readonly [TKey in TChatId]: TelegramAdapterData }>
> {
  const messageEvent = decodeTelegramTextMessage({
    chatId: args.chatId,
    context: args.context,
    botUserId: args.botUserId,
  });
  if (messageEvent.status === "ignored") {
    return messageEvent;
  }

  const command = parseTelegramCommand({
    commands: args.commands,
    context: args.context,
    botUsername: args.botUsername,
    diagnostic: args.diagnostic,
  });

  if (command.status === "unknown") {
    return {
      status: "event",
      event: {
        type: "command.unknown",
        chatId: args.chatId,
        conversation: messageEvent.event.conversation,
        message: {
          chatId: args.chatId,
          conversationId: messageEvent.event.conversation.conversationId,
          messageId: messageEvent.event.message.messageId,
        },
        actor: messageEvent.event.message.actor,
        commandName: command.commandName,
      },
    };
  }

  if (command.status === "invalid") {
    return {
      status: "event",
      event: {
        type: "command.invalid",
        chatId: args.chatId,
        conversation: messageEvent.event.conversation,
        message: {
          chatId: args.chatId,
          conversationId: messageEvent.event.conversation.conversationId,
          messageId: messageEvent.event.message.messageId,
        },
        actor: messageEvent.event.message.actor,
        commandName: command.commandName,
        reason: command.reason,
        optionName: command.optionName,
      },
    };
  }

  if (command.status !== "command") {
    return messageEvent;
  }

  return {
    status: "event",
    event: createTelegramCommandEvent({
      chatId: args.chatId,
      conversationId: messageEvent.event.conversation.conversationId,
      messageId: messageEvent.event.message.messageId,
      actor: messageEvent.event.message.actor,
      command: command.command,
    }),
  };
}

export function decodeTelegramActionUpdate<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramCallbackQueryDataContext;
}): TelegramInboundDecodeResult<ChatAdapterActionEvent<TChatId>> {
  const decoded = decodeTelegramActionCallbackData(args.context.callbackQuery.data);
  const message = args.context.callbackQuery.message;
  const chat = message?.chat ?? args.context.chat;

  if (decoded === undefined || message === undefined || chat === undefined) {
    return { status: "ignored", reason: "unsupported_action" };
  }

  const adapterData = decodeTelegramAdapterData({
    chatId: chat.id,
    messageId: message.message_id,
    raw: args.context.callbackQuery,
    updateId: args.context.update.update_id,
  });
  const conversation = {
    chatId: args.chatId,
    conversationId: String(chat.id),
  };

  return {
    status: "event",
    event: {
      type: "action",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: String(message.message_id),
      },
      interactionId: args.context.callbackQuery.id,
      actor: decodeTelegramActor({ chat, from: args.context.from, adapterData }),
      actionId: decoded.actionId,
      value: decoded.value,
      ...(decoded.payload === undefined ? {} : { payload: decoded.payload }),
    },
  };
}

function decodeTelegramTextMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramTextMessageContext;
  readonly botUserId: number;
}): TelegramInboundDecodeResult<ChatAdapterMessageEvent<TChatId, TelegramAdapterData>> {
  const message = args.context.message;
  const chat = message.chat;
  const from = message.from ?? args.context.from;

  if (from?.id === args.botUserId) {
    return { status: "ignored", reason: "self_message" };
  }

  const conversation = {
    chatId: args.chatId,
    conversationId: String(chat.id),
  };
  const adapterData = decodeTelegramAdapterData({
    chatId: chat.id,
    messageId: message.message_id,
    raw: message,
    updateId: args.context.update.update_id,
  });

  return {
    status: "event",
    event: {
      type: "message",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: String(message.message_id),
        text: message.text,
        format: "plain",
        actor: decodeTelegramActor({ chat, from, adapterData }),
        adapterData,
      },
    },
  };
}

function decodeTelegramAdapterData(args: {
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

type TelegramActorChat = {
  readonly id: number | string;
  readonly title?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
};

type TelegramActorUser = TelegramTextMessageContext["from"];

function decodeTelegramActor(args: {
  readonly chat: TelegramActorChat;
  readonly from: TelegramActorUser;
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

function formatTelegramDisplayName(from: NonNullable<TelegramActorUser>): string {
  return (
    [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(from.id)
  );
}

function formatTelegramChatName(chat: TelegramActorChat): string | undefined {
  return (
    chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username)
  );
}
