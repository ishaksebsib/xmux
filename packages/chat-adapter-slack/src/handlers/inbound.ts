import {
  serializeChatLogError,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import { slackLogEvents, type SlackLogScope } from "../logger";
import type { SlackAdapterData } from "../types";
import type { SlackAdapterError } from "../errors";

export function registerInboundHandlers<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly logger: SlackLogScope;
}): void {
  args.client.onMessage((event) => {
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "message",
      reason: "not_implemented_until_phase_5",
      eventType: event.event.type,
    });
  });

  args.client.onCommand((event) => {
    void ackImmediately({
      chatId: args.chatId,
      context: args.context,
      logger: args.logger,
      operation: "command",
      ack: event.ack,
    });
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "command",
      reason: "not_implemented_until_phase_4",
      command: event.payload.command,
    });
  });

  args.client.onAction((event) => {
    void ackImmediately({
      chatId: args.chatId,
      context: args.context,
      logger: args.logger,
      operation: "action",
      ack: event.ack,
    });
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "action",
      reason: "not_implemented_until_phase_6",
      actionType: event.action.type,
    });
  });

  args.client.onReactionAdded((event) => {
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "reaction_added",
      reason: "not_implemented_until_phase_5",
      eventType: event.event.type,
    });
  });

  args.client.onReactionRemoved((event) => {
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "reaction_removed",
      reason: "not_implemented_until_phase_5",
      eventType: event.event.type,
    });
  });
}

function ackImmediately<TChatId extends string, TCommands extends ChatCommandRegistry>(args: {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly logger: SlackLogScope;
  readonly operation: "command" | "action";
  readonly ack: () => Promise<void>;
}): Promise<void> {
  return args.ack().catch((error: unknown) => {
    args.logger.error(slackLogEvents.backgroundFailure, {
      operation: args.operation,
      reason: "ack_failed",
      error: serializeChatLogError(error),
    });
    args.context.emit({ type: "error", chatId: args.chatId, error });
  });
}
