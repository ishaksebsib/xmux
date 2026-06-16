import {
  createChatLogScope,
  logChatResult,
  type ChatLogger,
  type ChatLogEventName,
  type ChatLogMetadata,
  type ChatLogScope,
} from "@xmux/chat-core";

export const slackLogEvents = {
  openBegin: "xmux.slack.open.begin",
  openSuccess: "xmux.slack.open.success",
  openFailure: "xmux.slack.open.failure",
  startBegin: "xmux.slack.start.begin",
  startSuccess: "xmux.slack.start.success",
  startFailure: "xmux.slack.start.failure",
  closeBegin: "xmux.slack.close.begin",
  closeSuccess: "xmux.slack.close.success",
  closeFailure: "xmux.slack.close.failure",
  commandsManual: "xmux.slack.commands.manual",
  inboundEvent: "xmux.slack.inbound.event",
  inboundIgnored: "xmux.slack.inbound.ignored",
  outboundBegin: "xmux.slack.outbound.begin",
  outboundSuccess: "xmux.slack.outbound.success",
  outboundFailure: "xmux.slack.outbound.failure",
  socketReady: "xmux.slack.socket.ready",
  socketFailure: "xmux.slack.socket.failure",
  backgroundFailure: "xmux.slack.background.failure",
} as const satisfies Record<string, `xmux.slack.${string}`>;

export type SlackLogEventName = (typeof slackLogEvents)[keyof typeof slackLogEvents];
export type SlackLogScope = ChatLogScope<SlackLogEventName | ChatLogEventName>;

export function createSlackLogScope(args: {
  readonly logger?: ChatLogger;
  readonly chatId: string;
  readonly mode?: string;
}): SlackLogScope {
  return createChatLogScope<SlackLogEventName | ChatLogEventName>(args.logger, {
    component: "@xmux/chat-adapter-slack",
    packageName: "@xmux/chat-adapter-slack",
    adapter: "slack",
    chatId: args.chatId,
    mode: args.mode,
  });
}

export { logChatResult };
export type { ChatLogger, ChatLogMetadata };
