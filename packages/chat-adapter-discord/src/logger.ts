import {
  createChatLogScope,
  logChatResult,
  type ChatLogger,
  type ChatLogEventName,
  type ChatLogMetadata,
  type ChatLogScope,
} from "@xmux/chat-core";

export const discordLogEvents = {
  openBegin: "xmux.discord.open.begin",
  openSuccess: "xmux.discord.open.success",
  openFailure: "xmux.discord.open.failure",
  startBegin: "xmux.discord.start.begin",
  startSuccess: "xmux.discord.start.success",
  startFailure: "xmux.discord.start.failure",
  closeBegin: "xmux.discord.close.begin",
  closeSuccess: "xmux.discord.close.success",
  closeFailure: "xmux.discord.close.failure",
  commandsRegisterBegin: "xmux.discord.commands.register.begin",
  commandsRegisterSuccess: "xmux.discord.commands.register.success",
  commandsRegisterFailure: "xmux.discord.commands.register.failure",
  commandsRegisterWarning: "xmux.discord.commands.register.warning",
  inboundEvent: "xmux.discord.inbound.event",
  inboundIgnored: "xmux.discord.inbound.ignored",
  outboundBegin: "xmux.discord.outbound.begin",
  outboundSuccess: "xmux.discord.outbound.success",
  outboundFailure: "xmux.discord.outbound.failure",
  gatewayReady: "xmux.discord.gateway.ready",
  gatewayFailure: "xmux.discord.gateway.failure",
  backgroundFailure: "xmux.discord.background.failure",
} as const satisfies Record<string, `xmux.discord.${string}`>;

export type DiscordLogEventName = (typeof discordLogEvents)[keyof typeof discordLogEvents];
export type DiscordLogScope = ChatLogScope<DiscordLogEventName | ChatLogEventName>;

export function createDiscordLogScope(args: {
  readonly logger?: ChatLogger;
  readonly chatId: string;
  readonly mode?: string;
}): DiscordLogScope {
  return createChatLogScope<DiscordLogEventName | ChatLogEventName>(args.logger, {
    component: "@xmux/chat-adapter-discord",
    packageName: "@xmux/chat-adapter-discord",
    adapter: "discord",
    chatId: args.chatId,
    mode: args.mode,
  });
}

export { logChatResult };
export type { ChatLogger, ChatLogMetadata };
