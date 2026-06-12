import {
  serializeChatLogError,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { decodeTelegramActionUpdate, decodeTelegramMessageUpdate } from "../conversions/inbound";
import { telegramLogEvents, type TelegramLogScope } from "../logger";
import type { TelegramAdapterData } from "../types";

export function registerInboundHandlers<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly context: ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData>;
  readonly logger: TelegramLogScope;
}): void {
  args.bot.catch((error) => {
    args.logger.error(telegramLogEvents.backgroundFailure, {
      operation: "grammyHandler",
      error: serializeChatLogError(error),
    });
    args.context.emit({ type: "error", chatId: args.chatId, error });
  });

  args.bot.onCallbackQueryData((telegramContext) => {
    const decoded = decodeTelegramActionUpdate({
      chatId: args.chatId,
      context: telegramContext,
    });

    if (decoded.status === "event") {
      args.logger.debug(telegramLogEvents.inboundEvent, {
        eventType: decoded.event.type,
        conversationId: decoded.event.conversation.conversationId,
        messageId: decoded.event.message.messageId,
        actionId: decoded.event.actionId,
      });
      args.context.emit(decoded.event);
      return;
    }

    args.logger.trace(telegramLogEvents.inboundIgnored, {
      result: "ignored",
      reason: decoded.reason,
    });
  });

  args.bot.onMessage((telegramContext) => {
    const botInfo = args.bot.getBotInfo();
    const decoded = decodeTelegramMessageUpdate<TCommands, TChatId>({
      chatId: args.chatId,
      commands: args.context.commands,
      context: telegramContext,
      bot: args.bot,
      botUserId: botInfo.id,
      botUsername: botInfo.username,
      logger: args.logger,
    });

    if (decoded.status === "event") {
      args.logger.debug(telegramLogEvents.inboundEvent, metadataForMessageEvent(decoded.event));
      args.context.emit(decoded.event);
      return;
    }

    args.logger.trace(telegramLogEvents.inboundIgnored, {
      result: "ignored",
      reason: decoded.reason,
    });
  });
}

function metadataForMessageEvent(event: {
  readonly type: string;
  readonly conversation?: { readonly conversationId: string };
  readonly message?: { readonly messageId?: string; readonly text?: string };
  readonly commandName?: string;
}) {
  return {
    eventType: event.type,
    conversationId: event.conversation?.conversationId,
    messageId: event.message?.messageId,
    commandName: event.commandName,
    textLength: event.message?.text?.length,
  } as const;
}
