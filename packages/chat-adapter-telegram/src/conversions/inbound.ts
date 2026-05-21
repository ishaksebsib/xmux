import type {
  ChatActor,
  ChatAdapterDiagnosticInput,
  ChatAdapterEvent,
  ChatAdapterMessageEvent,
  ChatCommandRegistry,
} from "@xmux/chat-core";
import type { TelegramTextMessageContext } from "../client";
import { createTelegramCommandEvent, parseTelegramCommand } from "../commands";
import type { TelegramAdapterData } from "../types";

export type TelegramInboundDecodeResult<TEvent> =
  | { readonly status: "event"; readonly event: TEvent }
  | { readonly status: "ignored"; readonly reason: "self_message" };

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

function decodeTelegramActor(args: {
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
  return (
    [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(from.id)
  );
}

function formatTelegramChatName(
  chat: TelegramTextMessageContext["message"]["chat"],
): string | undefined {
  return "title" in chat
    ? chat.title
    : "first_name" in chat
      ? [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username
      : undefined;
}
