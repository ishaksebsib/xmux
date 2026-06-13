import { Result } from "better-result";
import {
  serializeChatLogError,
  type ChatActor,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import type { MessageCreateOptions, MessageEditOptions } from "discord.js";
import {
  createDiscordCommandEvent,
  createDiscordInvalidCommandEvent,
  createDiscordUnknownCommandEvent,
  parseDiscordCommand,
  type DiscordChatInputInteractionLike,
} from "../commands";
import { decodeDiscordActionCustomId, isDiscordActionCustomId } from "../conversions/actions";
import { decodeDiscordMessage } from "../conversions/inbound";
import { decodeDiscordReaction } from "../conversions/reactions";
import type {
  DiscordBotClient,
  DiscordInteractionHandler,
  DiscordMessageHandler,
  DiscordReactionHandler,
  DiscordSentMessage,
} from "../client";
import { DiscordInboundDecodeError, type DiscordAdapterError } from "../errors";
import { discordLogEvents, type DiscordLogScope } from "../logger";
import type { DiscordInteractionRegistry } from "../stores/interaction-registry";
import type { DiscordActionStore, DiscordAdapterData, DiscordAdapterMode } from "../types";

export function registerInboundHandlers<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly actionStore?: DiscordActionStore;
  readonly logger: DiscordLogScope;
  readonly mode: DiscordAdapterMode;
}): void {
  args.client.onInteractionCreate(createInteractionHandler(args));

  if (args.mode.type === "gateway" && args.mode.observeMessages) {
    args.client.onMessageCreate(createMessageHandler(args));
  }

  if (args.mode.type === "gateway" && args.mode.observeReactions) {
    args.client.onReactionAdd(createReactionHandler(args, "reaction.added"));
    args.client.onReactionRemove(createReactionHandler(args, "reaction.removed"));
  }
}

function createMessageHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(
  args: RegisterHandlerArgs<TCommands, TChatId> & { readonly client: DiscordBotClient },
): DiscordMessageHandler {
  return (message) => {
    runGatewayHandler({
      ...args,
      eventType: "messageCreate",
      handle: async () => {
        const decoded = decodeDiscordMessage({
          chatId: args.chatId,
          client: args.client,
          message,
          botUserId: args.client.getBotUserId(),
        });

        if (decoded.status === "ignored") {
          args.logger.debug(discordLogEvents.inboundIgnored, {
            eventType: "messageCreate",
            reason: decoded.reason,
          });
          return;
        }

        args.logger.debug(discordLogEvents.inboundEvent, {
          eventType: decoded.event.type,
          conversationId: decoded.event.conversation.conversationId,
          messageId: decoded.event.message.messageId,
        });
        args.context.emit(decoded.event);
      },
    });
  };
}

function createInteractionHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(
  args: RegisterHandlerArgs<TCommands, TChatId>,
): DiscordInteractionHandler {
  return (interaction) => {
    runGatewayHandler({
      ...args,
      eventType: "interactionCreate",
      handle: async () => {
        if (isChatInputCommandInteraction(interaction)) {
          await handleChatInputCommandInteraction(args, interaction);
          return;
        }

        if (isButtonInteraction(interaction)) {
          await handleButtonInteraction(args, interaction);
          return;
        }

        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "interactionCreate",
          reason: "unsupported_interaction",
        });
      },
    });
  };
}

async function handleChatInputCommandInteraction<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(
  args: RegisterHandlerArgs<TCommands, TChatId>,
  interaction: DiscordChatInputInteractionRuntime,
): Promise<void> {
  await interaction.deferReply();

  const conversationId = interaction.channelId;
  const actor = createDiscordInteractionActor(interaction);
  putInteractionContext({ args, interaction, conversationId });

  const parsed = parseDiscordCommand({
    commands: args.context.commands,
    interaction,
    logger: args.logger,
  });
  const event =
    parsed.status === "command"
      ? createDiscordCommandEvent({
          chatId: args.chatId,
          conversationId,
          interactionId: interaction.id,
          actor,
          command: parsed.command,
        })
      : parsed.status === "unknown"
        ? createDiscordUnknownCommandEvent({
            chatId: args.chatId,
            conversationId,
            interactionId: interaction.id,
            actor,
            commandName: parsed.commandName,
          })
        : createDiscordInvalidCommandEvent({
            chatId: args.chatId,
            conversationId,
            interactionId: interaction.id,
            actor,
            commandName: parsed.commandName,
            reason: parsed.reason,
            optionName: parsed.optionName,
          });

  args.logger.debug(discordLogEvents.inboundEvent, {
    eventType: event.type,
    conversationId,
    interactionId: interaction.id,
    commandName: interaction.commandName,
  });
  args.context.emit(event);
}

async function handleButtonInteraction<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(
  args: RegisterHandlerArgs<TCommands, TChatId>,
  interaction: DiscordButtonInteractionRuntime,
): Promise<void> {
  await interaction.deferUpdate();

  const conversationId = interaction.channelId;
  const actor = createDiscordInteractionActor(interaction);
  putInteractionContext({ args, interaction, conversationId });

  if (!isDiscordActionCustomId(interaction.customId)) {
    args.logger.debug(discordLogEvents.inboundIgnored, {
      eventType: "interactionCreate",
      reason: "foreign_button_custom_id",
    });
    return;
  }

  const envelope = await decodeDiscordActionCustomId({
    customId: interaction.customId,
    actionStore: args.actionStore,
  });
  if (envelope.isErr()) {
    throw envelope.error;
  }

  const event = {
    type: "action",
    chatId: args.chatId,
    conversation: { chatId: args.chatId, conversationId },
    message: {
      chatId: args.chatId,
      conversationId,
      messageId: interaction.message.id,
    },
    interactionId: interaction.id,
    actor,
    actionId: envelope.value.actionId,
    value: envelope.value.value,
    ...(envelope.value.payload === undefined ? {} : { payload: envelope.value.payload }),
  } as const;

  args.logger.debug(discordLogEvents.inboundEvent, {
    eventType: event.type,
    conversationId,
    interactionId: interaction.id,
    actionId: event.actionId,
    value: event.value,
  });
  args.context.emit(event);
}

function putInteractionContext<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly args: RegisterHandlerArgs<TCommands, TChatId>;
  readonly interaction: DiscordResponseInteractionRuntime;
  readonly conversationId: string;
}): void {
  args.args.interactionRegistry.put({
    interactionId: args.interaction.id,
    channelId: args.conversationId,
    guildId: args.interaction.guildId ?? undefined,
    createdAt: Date.now(),
    editReply: async (payload) =>
      encodeInteractionSentMessage({
        message: await args.interaction.editReply(payload),
        fallbackChannelId: args.conversationId,
        fallbackGuildId: args.interaction.guildId ?? undefined,
      }),
    followUp: async (payload) =>
      encodeInteractionSentMessage({
        message: await args.interaction.followUp(payload),
        fallbackChannelId: args.conversationId,
        fallbackGuildId: args.interaction.guildId ?? undefined,
      }),
  });
}

function createReactionHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(
  args: RegisterHandlerArgs<TCommands, TChatId> & { readonly client: DiscordBotClient },
  type: "reaction.added" | "reaction.removed",
): DiscordReactionHandler {
  return (reaction, user) => {
    runGatewayHandler({
      ...args,
      eventType: "messageReaction",
      handle: async () => {
        const resolved = await resolveDiscordReactionPartials(reaction, user);
        const decoded = decodeDiscordReaction({
          chatId: args.chatId,
          type,
          reaction: resolved.reaction,
          user: resolved.user,
          botUserId: args.client.getBotUserId(),
        });

        if (decoded.status === "ignored") {
          args.logger.debug(discordLogEvents.inboundIgnored, {
            eventType: "messageReaction",
            reason: decoded.reason,
          });
          return;
        }

        args.logger.debug(discordLogEvents.inboundEvent, {
          eventType: decoded.event.type,
          conversationId: decoded.event.message.conversationId,
          messageId: decoded.event.message.messageId,
          reaction: decoded.event.reaction,
        });
        args.context.emit(decoded.event);
      },
    });
  };
}

async function resolveDiscordReactionPartials(
  reaction: unknown,
  user: unknown,
): Promise<{ readonly reaction: unknown; readonly user: unknown }> {
  const resolvedReaction = await fetchDiscordPartial(reaction);
  const resolvedMessage = isRecord(resolvedReaction)
    ? await fetchDiscordPartial(resolvedReaction.message)
    : undefined;
  const resolvedUser = await fetchDiscordPartial(user);

  return {
    reaction:
      resolvedMessage === undefined
        ? resolvedReaction
        : withResolvedDiscordReactionMessage(resolvedReaction, resolvedMessage),
    user: resolvedUser,
  };
}

async function fetchDiscordPartial(value: unknown): Promise<unknown> {
  if (!isRecord(value) || value.partial !== true || typeof value.fetch !== "function") {
    return value;
  }

  return (await value.fetch()) ?? value;
}

function withResolvedDiscordReactionMessage(reaction: unknown, message: unknown): unknown {
  if (!isRecord(reaction)) return reaction;

  return new Proxy(reaction, {
    get(target, property, receiver) {
      return property === "message" ? message : Reflect.get(target, property, receiver);
    },
  });
}

type RegisterHandlerArgs<TCommands extends ChatCommandRegistry, TChatId extends string> = {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly actionStore?: DiscordActionStore;
  readonly logger: DiscordLogScope;
};

function runGatewayHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: ChatAdapterStartContext<
    TCommands,
    TChatId,
    DiscordAdapterData,
    DiscordAdapterError
  >;
  readonly logger: DiscordLogScope;
  readonly eventType: string;
  readonly handle: () => Promise<void>;
}): void {
  void Result.tryPromise({
    try: args.handle,
    catch: (cause) => new DiscordInboundDecodeError({ eventType: args.eventType, cause }),
  }).then((result) => {
    if (result.isOk()) {
      return;
    }

    args.logger.error(discordLogEvents.backgroundFailure, {
      operation: "inbound",
      eventType: args.eventType,
      error: serializeChatLogError(result.error),
    });
    args.context.emit({ type: "error", chatId: args.chatId, error: result.error });
  });
}

interface DiscordResponseInteractionRuntime {
  readonly id: string;
  readonly channelId: string;
  readonly guildId?: string | null;
  readonly user?: {
    readonly id?: string;
    readonly username?: string;
    readonly globalName?: string | null;
    readonly bot?: boolean;
  };
  editReply(payload: string | MessageCreateOptions | MessageEditOptions): Promise<unknown>;
  followUp(payload: string | MessageCreateOptions): Promise<unknown>;
}

interface DiscordChatInputInteractionRuntime
  extends DiscordResponseInteractionRuntime, DiscordChatInputInteractionLike {
  isChatInputCommand(): boolean;
  deferReply(): Promise<unknown>;
}

interface DiscordButtonInteractionRuntime extends DiscordResponseInteractionRuntime {
  readonly customId: string;
  readonly message: { readonly id: string };
  isButton(): boolean;
  deferUpdate(): Promise<unknown>;
}

function isChatInputCommandInteraction(
  interaction: unknown,
): interaction is DiscordChatInputInteractionRuntime {
  return (
    isRecord(interaction) &&
    typeof interaction.id === "string" &&
    typeof interaction.channelId === "string" &&
    typeof interaction.commandName === "string" &&
    typeof interaction.isChatInputCommand === "function" &&
    interaction.isChatInputCommand() &&
    typeof interaction.deferReply === "function" &&
    typeof interaction.editReply === "function" &&
    typeof interaction.followUp === "function"
  );
}

function isButtonInteraction(interaction: unknown): interaction is DiscordButtonInteractionRuntime {
  return (
    isRecord(interaction) &&
    typeof interaction.id === "string" &&
    typeof interaction.channelId === "string" &&
    typeof interaction.customId === "string" &&
    isRecord(interaction.message) &&
    typeof interaction.message.id === "string" &&
    typeof interaction.isButton === "function" &&
    interaction.isButton() &&
    typeof interaction.deferUpdate === "function" &&
    typeof interaction.editReply === "function" &&
    typeof interaction.followUp === "function"
  );
}

function createDiscordInteractionActor(
  interaction: DiscordResponseInteractionRuntime,
): ChatActor | undefined {
  const user = interaction.user;
  if (user?.id === undefined) {
    return undefined;
  }

  return {
    kind: user.bot === true ? "bot" : "user",
    actorId: user.id,
    displayName: user.globalName ?? user.username,
    adapterData: {
      discordChannelId: interaction.channelId,
      discordInteractionId: interaction.id,
      discordUserId: user.id,
      raw: user,
    },
  };
}

function encodeInteractionSentMessage(args: {
  readonly message: unknown;
  readonly fallbackChannelId: string;
  readonly fallbackGuildId?: string;
}): DiscordSentMessage {
  const message = isRecord(args.message) ? args.message : {};
  return {
    channelId: typeof message.channelId === "string" ? message.channelId : args.fallbackChannelId,
    messageId: typeof message.id === "string" ? message.id : "interaction-response",
    guildId: typeof message.guildId === "string" ? message.guildId : args.fallbackGuildId,
    raw: args.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
