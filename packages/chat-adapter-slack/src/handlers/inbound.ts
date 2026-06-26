import {
  serializeChatLogError,
  type ChatAdapterMessageEvent,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import {
  createSlackCommandEvent,
  createSlackInvalidCommandEvent,
  createSlackMentionCommandEvent,
  createSlackMentionInvalidCommandEvent,
  createSlackMentionUnknownCommandEvent,
  createSlackUnknownCommandEvent,
  parseSlackCommand,
  parseSlackMentionCommand,
} from "../commands";
import type {
  SlackActionEvent,
  SlackAppMentionEvent,
  SlackBotClient,
  SlackBotIdentity,
  SlackCommandEvent,
  SlackMessageEvent,
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
import type { SlackStreamSourceRegistry } from "../stores/stream-source-registry";
import type {
  SlackActionStore,
  SlackAdapterData,
  SlackCommandMode,
  SlackConversationScope,
  SlackMentionCommandOptions,
} from "../types";
import type { SlackAdapterError } from "../errors";
import { nonEmpty } from "../utils";

export function registerInboundHandlers<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly commandMode: SlackCommandMode;
  readonly mentionCommands: Required<SlackMentionCommandOptions>;
  readonly conversationScope: SlackConversationScope;
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
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): void {
  args.client.onMessage((event) =>
    runInboundHandler({
      ...args,
      eventType: "message",
      handle: () => handleMessageEvent({ ...args, event }),
    }),
  );

  if (args.mentionCommands.enabled) {
    args.client.onAppMention((event) =>
      runInboundHandler({
        ...args,
        eventType: "app_mention",
        handle: () => handleAppMentionEvent({ ...args, event }),
      }),
    );
  }

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

function handleMessageEvent<TChatId extends string, TCommands extends ChatCommandRegistry>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackMessageEvent;
  readonly logger: SlackLogScope;
  readonly mentionCommands: Required<SlackMentionCommandOptions>;
  readonly conversationScope: SlackConversationScope;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): void {
  if (isSlackRetry(args.event)) {
    logRetryIgnored({ logger: args.logger, operation: "message", event: args.event });
    return;
  }

  const decoded = decodeSlackInboundMessage({ ...args, operation: "message" });
  if (decoded === undefined) return;

  if (args.mentionCommands.enabled && emitSlackMentionCommandEvent({ ...args, source: decoded })) {
    return;
  }

  emitSlackMessageEvent({ context: args.context, event: decoded, logger: args.logger });
}

function handleAppMentionEvent<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackAppMentionEvent;
  readonly logger: SlackLogScope;
  readonly conversationScope: SlackConversationScope;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): void {
  if (isSlackRetry(args.event)) {
    logRetryIgnored({ logger: args.logger, operation: "app_mention", event: args.event });
    return;
  }

  const decoded = decodeSlackInboundMessage({ ...args, operation: "app_mention" });
  if (decoded === undefined) return;

  if (emitSlackMentionCommandEvent({ ...args, source: decoded })) return;

  emitSlackMessageEvent({ context: args.context, event: decoded, logger: args.logger });
}

function emitSlackMentionCommandEvent<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackMessageEvent | SlackAppMentionEvent;
  readonly logger: SlackLogScope;
  readonly source: ChatAdapterMessageEvent<TChatId, SlackAdapterData, SlackAdapterError>;
}): boolean {
  const parsed = parseSlackMentionCommand({
    commands: args.context.commands,
    text: slackEventText(args.event.event),
    botUserId: args.botIdentity?.botUserId,
    logger: args.logger,
  });

  if (parsed.status === "not_command") return false;

  const commandEvent =
    parsed.status === "command"
      ? createSlackMentionCommandEvent({
          source: args.source,
          command: parsed.command,
        })
      : parsed.status === "unknown"
        ? createSlackMentionUnknownCommandEvent({
            source: args.source,
            commandName: parsed.commandName,
          })
        : createSlackMentionInvalidCommandEvent({
            source: args.source,
            commandName: parsed.commandName,
            reason: parsed.reason,
            optionName: parsed.optionName,
          });

  args.logger.debug(slackLogEvents.inboundEvent, {
    eventType: commandEvent.type,
    conversationId: commandEvent.conversation.conversationId,
    messageId: commandEvent.message?.messageId,
    commandName: parsed.status === "command" ? parsed.command.name : parsed.commandName,
  });
  args.context.emit(commandEvent);
  return true;
}

function decodeSlackInboundMessage<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly botIdentity?: SlackBotIdentity;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: SlackMessageEvent | SlackAppMentionEvent;
  readonly logger: SlackLogScope;
  readonly operation: "message" | "app_mention";
  readonly conversationScope: SlackConversationScope;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): ChatAdapterMessageEvent<TChatId, SlackAdapterData, SlackAdapterError> | undefined {
  const decoded = decodeSlackMessageEvent({
    chatId: args.chatId,
    client: args.client,
    event: args.event.event,
    botIdentity: args.botIdentity,
    conversationScope: args.conversationScope,
  });

  if (decoded.status === "ignored") {
    args.logger.debug(slackLogEvents.inboundIgnored, {
      operation: args.operation,
      reason: decoded.reason,
      eventType: args.event.event.type,
    });
    return undefined;
  }

  rememberSlackStreamSource({
    botIdentity: args.botIdentity,
    event: decoded.event,
    registry: args.streamSourceRegistry,
  });

  return decoded.event;
}

function emitSlackMessageEvent<
  TChatId extends string,
  TCommands extends ChatCommandRegistry,
>(args: {
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    SlackAdapterData,
    SlackAdapterError
  >;
  readonly event: ChatAdapterMessageEvent<TChatId, SlackAdapterData, SlackAdapterError>;
  readonly logger: SlackLogScope;
}): void {
  args.logger.debug(slackLogEvents.inboundEvent, {
    eventType: args.event.type,
    conversationId: args.event.conversation.conversationId,
    messageId: args.event.message.messageId,
  });
  args.context.emit(args.event);
}

function rememberSlackStreamSource<TChatId extends string>(args: {
  readonly botIdentity?: SlackBotIdentity;
  readonly event: ChatAdapterMessageEvent<TChatId, SlackAdapterData, SlackAdapterError>;
  readonly registry: SlackStreamSourceRegistry;
}): void {
  const channelId = nonEmpty(args.event.message.adapterData.slackChannelId);
  const messageTs = nonEmpty(args.event.message.messageId);
  if (channelId === undefined || messageTs === undefined) return;

  const adapterData = args.event.message.adapterData;
  const recipientUserId =
    nonEmpty(adapterData.slackUserId) ?? nonEmpty(args.event.message.actor.actorId);
  const recipientTeamId = nonEmpty(adapterData.slackTeamId) ?? nonEmpty(args.botIdentity?.teamId);
  const threadTs = nonEmpty(adapterData.slackThreadTs) ?? messageTs;

  args.registry.put({
    channelId,
    messageTs,
    threadTs,
    ...(recipientUserId === undefined ? {} : { recipientUserId }),
    ...(recipientTeamId === undefined ? {} : { recipientTeamId }),
  });
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
  readonly conversationScope: SlackConversationScope;
}): Promise<void> {
  const decoded = await decodeSlackActionEvent({
    chatId: args.chatId,
    event: args.event,
    actionStore: args.actionStore,
    conversationScope: args.conversationScope,
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
  readonly conversationScope: SlackConversationScope;
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
        conversationScope: args.conversationScope,
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
  readonly conversationScope: SlackConversationScope;
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
          conversationScope: args.conversationScope,
          command: parsed.command,
        })
      : parsed.status === "unknown"
        ? createSlackUnknownCommandEvent({
            chatId: args.chatId,
            payload: args.event.payload,
            conversationScope: args.conversationScope,
            commandName: parsed.commandName,
          })
        : createSlackInvalidCommandEvent({
            chatId: args.chatId,
            payload: args.event.payload,
            conversationScope: args.conversationScope,
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

function slackEventText(event: unknown): string {
  if (typeof event !== "object" || event === null) return "";

  const text = (event as { readonly text?: unknown }).text;
  return typeof text === "string" ? text : "";
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
