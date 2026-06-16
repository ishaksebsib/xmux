import {
  serializeChatLogError,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import {
  createSlackCommandEvent,
  createSlackInvalidCommandEvent,
  createSlackUnknownCommandEvent,
  parseSlackCommand,
} from "../commands";
import type {
  SlackActionEvent,
  SlackBotClient,
  SlackBotIdentity,
  SlackCommandEvent,
  SlackReactionEvent,
  SlackRetryMetadata,
} from "../client";
import { decodeSlackActionEvent } from "../conversions/actions";
import { decodeSlackMessageEvent } from "../conversions/inbound";
import { decodeSlackReactionEvent } from "../conversions/reactions";
import { slackLogEvents, type SlackLogScope } from "../logger";
import {
  createSlackCommandInteractionId,
  type SlackInteractionRegistry,
} from "../stores/interaction-registry";
import type { SlackActionStore, SlackAdapterData, SlackCommandMode } from "../types";
import type { SlackAdapterError } from "../errors";

export function registerInboundHandlers<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly commandMode: SlackCommandMode;
  readonly actionStore?: SlackActionStore;
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly interactionRegistry: SlackInteractionRegistry;
  readonly logger: SlackLogScope;
}): void {
  args.client.onMessage((event) =>
    runInboundHandler({
      ...args,
      eventType: "message",
      handle: () => {
        if (isSlackRetry(event)) {
          logRetryIgnored({ logger: args.logger, operation: "message", event });
          return;
        }

        const decoded = decodeSlackMessageEvent({
          chatId: args.chatId,
          client: args.client,
          event: event.event,
          botIdentity: args.botIdentity,
        });

        if (decoded.status === "ignored") {
          args.logger.debug(slackLogEvents.inboundIgnored, {
            operation: "message",
            reason: decoded.reason,
            eventType: event.event.type,
          });
          return;
        }

        args.logger.debug(slackLogEvents.inboundEvent, {
          eventType: decoded.event.type,
          conversationId: decoded.event.conversation.conversationId,
          messageId: decoded.event.message.messageId,
        });
        args.context.emit(decoded.event);
      },
    }),
  );

  args.client.onCommand((event) =>
    runInboundHandler({
      ...args,
      eventType: "command",
      handle: async () => {
        await ackImmediately({
          chatId: args.chatId,
          context: args.context,
          logger: args.logger,
          operation: "command",
          ack: event.ack,
        });
        if (isSlackRetry(event)) {
          logRetryIgnored({ logger: args.logger, operation: "command", event });
          return;
        }
        handleCommandEvent({ ...args, event });
      },
    }),
  );

  args.client.onAction((event) =>
    runInboundHandler({
      ...args,
      eventType: "action",
      handle: async () => {
        await ackImmediately({
          chatId: args.chatId,
          context: args.context,
          logger: args.logger,
          operation: "action",
          ack: event.ack,
        });
        if (isSlackRetry(event)) {
          logRetryIgnored({ logger: args.logger, operation: "action", event });
          return;
        }
        await handleActionEvent({ ...args, event });
      },
    }),
  );

  args.client.onReactionAdded((event) =>
    handleReactionEvent({ ...args, operation: "reaction_added", event }),
  );

  args.client.onReactionRemoved((event) =>
    handleReactionEvent({ ...args, operation: "reaction_removed", event }),
  );
}

async function handleActionEvent<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly actionStore?: SlackActionStore;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackActionEvent;
  readonly interactionRegistry: SlackInteractionRegistry;
  readonly logger: SlackLogScope;
}): Promise<void> {
  const decoded = await decodeSlackActionEvent({
    chatId: args.chatId,
    event: args.event,
    actionStore: args.actionStore,
  });
  if (decoded.isErr()) {
    throw decoded.error;
  }

  if (decoded.value.status === "ignored") {
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: "action",
      reason: decoded.value.reason,
      actionType: args.event.action.type,
    });
    return;
  }

  args.interactionRegistry.putAction(decoded.value.context);
  args.logger.debug(slackLogEvents.inboundEvent, {
    eventType: decoded.value.event.type,
    conversationId: decoded.value.event.conversation.conversationId,
    messageId: decoded.value.event.message.messageId,
    interactionId: decoded.value.event.interactionId,
    actionId: decoded.value.event.actionId,
    value: decoded.value.event.value,
  });
  args.context.emit(decoded.value.event);
}

function handleReactionEvent<TChatId extends string, TCommands extends ChatCommandRegistry>(args: {
  readonly chatId: TChatId;
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackReactionEvent;
  readonly logger: SlackLogScope;
  readonly operation: "reaction_added" | "reaction_removed";
}): void {
  void runInboundHandler({
    ...args,
    eventType: args.operation,
    handle: () => {
      if (isSlackRetry(args.event)) {
        logRetryIgnored({ logger: args.logger, operation: args.operation, event: args.event });
        return;
      }

      const decoded = decodeSlackReactionEvent({
        chatId: args.chatId,
        event: args.event.event,
        botIdentity: args.botIdentity,
      });

      if (decoded.status === "ignored") {
        args.logger.debug(slackLogEvents.inboundIgnored, {
          operation: args.operation,
          reason: decoded.reason,
          eventType: args.event.event.type,
        });
        return;
      }

      args.logger.debug(slackLogEvents.inboundEvent, {
        eventType: decoded.event.type,
        conversationId: decoded.event.message.conversationId,
        messageId: decoded.event.message.messageId,
        reaction: decoded.event.reaction,
      });
      args.context.emit(decoded.event);
    },
  });
}

function handleCommandEvent<TChatId extends string, TCommands extends ChatCommandRegistry>(args: {
  readonly chatId: TChatId;
  readonly commandMode: SlackCommandMode;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackCommandEvent;
  readonly interactionRegistry: SlackInteractionRegistry;
  readonly logger: SlackLogScope;
}): void {
  putCommandInteractionContext(args);

  const parsed = parseSlackCommand({
    commands: args.context.commands,
    payload: args.event.payload,
    commandMode: args.commandMode,
    logger: args.logger,
  });
  const event =
    parsed.status === "command"
      ? createSlackCommandEvent({
          chatId: args.chatId,
          payload: args.event.payload,
          command: parsed.command,
        })
      : parsed.status === "unknown"
        ? createSlackUnknownCommandEvent({
            chatId: args.chatId,
            payload: args.event.payload,
            commandName: parsed.commandName,
          })
        : createSlackInvalidCommandEvent({
            chatId: args.chatId,
            payload: args.event.payload,
            commandName: parsed.commandName,
            reason: parsed.reason,
            optionName: parsed.optionName,
          });

  args.logger.debug(slackLogEvents.inboundEvent, {
    eventType: event.type,
    conversationId: event.conversation.conversationId,
    commandName: parsed.status === "command" ? parsed.command.name : parsed.commandName,
  });
  args.context.emit(event);
}

function putCommandInteractionContext<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackCommandEvent;
  readonly interactionRegistry: SlackInteractionRegistry;
}): void {
  const interactionId = createSlackCommandInteractionId(args.event.payload);
  args.interactionRegistry.putCommand({
    interactionId,
    commandId: args.event.payload.trigger_id,
    commandName: args.event.payload.command,
    responseUrl: args.event.payload.response_url,
    channelId: args.event.payload.channel_id,
    userId: args.event.payload.user_id,
    triggerId: args.event.payload.trigger_id,
    createdAt: Date.now(),
    raw: args.event.payload,
  });
}

async function runInboundHandler<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly eventType: string;
  readonly handle: () => Promise<void> | void;
  readonly logger: SlackLogScope;
}): Promise<void> {
  try {
    await args.handle();
  } catch (error) {
    args.logger.error(slackLogEvents.backgroundFailure, {
      operation: "inbound",
      eventType: args.eventType,
      error: serializeChatLogError(error),
    });
    args.context.emit({ type: "error", chatId: args.chatId, error });
  }
}

function isSlackRetry(event: SlackRetryMetadata): boolean {
  return event.retryNum !== undefined && event.retryNum > 0;
}

function logRetryIgnored(args: {
  readonly logger: SlackLogScope;
  readonly operation: string;
  readonly event: SlackRetryMetadata;
}): void {
  args.logger.debug(slackLogEvents.inboundIgnored, {
    operation: args.operation,
    reason: "slack_retry",
    retryNum: args.event.retryNum,
    retryReason: args.event.retryReason,
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
