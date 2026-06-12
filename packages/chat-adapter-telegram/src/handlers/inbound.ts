import type { ChatAdapterStartContext, ChatCommandRegistry } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { decodeTelegramActionUpdate, decodeTelegramMessageUpdate } from "../conversions/inbound";
import type { TelegramAdapterData } from "../types";

export function registerInboundHandlers<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly context: ChatAdapterStartContext<TCommands, TChatId, TelegramAdapterData>;
}): void {
  args.bot.catch((error) => {
    args.context.emit({ type: "error", chatId: args.chatId, error });
  });

  args.bot.onCallbackQueryData((telegramContext) => {
    const decoded = decodeTelegramActionUpdate({
      chatId: args.chatId,
      context: telegramContext,
    });

    if (decoded.status === "event") {
      args.context.emit(decoded.event);
    }
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
    });

    if (decoded.status === "event") {
      args.context.emit(decoded.event);
    }
  });
}
