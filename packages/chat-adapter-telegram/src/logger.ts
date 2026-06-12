import {
  createChatLogScope,
  logChatResult,
  type ChatLogger,
  type ChatLogEventName,
  type ChatLogMetadata,
  type ChatLogScope,
} from "@xmux/chat-core";

export const telegramLogEvents = {
  openBegin: "xmux.telegram.open.begin",
  openSuccess: "xmux.telegram.open.success",
  openFailure: "xmux.telegram.open.failure",
  startBegin: "xmux.telegram.start.begin",
  startSuccess: "xmux.telegram.start.success",
  startFailure: "xmux.telegram.start.failure",
  closeBegin: "xmux.telegram.close.begin",
  closeSuccess: "xmux.telegram.close.success",
  closeFailure: "xmux.telegram.close.failure",
  commandsRegisterBegin: "xmux.telegram.commands.register.begin",
  commandsRegisterSuccess: "xmux.telegram.commands.register.success",
  commandsRegisterFailure: "xmux.telegram.commands.register.failure",
  pollingStart: "xmux.telegram.polling.start",
  pollingFailure: "xmux.telegram.polling.failure",
  inboundEvent: "xmux.telegram.inbound.event",
  inboundIgnored: "xmux.telegram.inbound.ignored",
  outboundBegin: "xmux.telegram.outbound.begin",
  outboundSuccess: "xmux.telegram.outbound.success",
  outboundFailure: "xmux.telegram.outbound.failure",
  backgroundFailure: "xmux.telegram.background.failure",
} as const satisfies Record<string, `xmux.telegram.${string}`>;

export type TelegramLogEventName = (typeof telegramLogEvents)[keyof typeof telegramLogEvents];
export type TelegramLogScope = ChatLogScope<TelegramLogEventName | ChatLogEventName>;

export function createTelegramLogScope(args: {
  readonly logger?: ChatLogger;
  readonly chatId: string;
  readonly mode?: string;
}): TelegramLogScope {
  return createChatLogScope<TelegramLogEventName | ChatLogEventName>(args.logger, {
    component: "@xmux/chat-adapter-telegram",
    packageName: "@xmux/chat-adapter-telegram",
    adapter: "telegram",
    chatId: args.chatId,
    mode: args.mode,
  });
}

export { logChatResult };
export type { ChatLogger, ChatLogMetadata };
