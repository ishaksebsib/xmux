import { Result } from "better-result";
import {
  serializeChatLogError,
  type ChatActor,
  type ChatAdapterStartContext,
  type ChatCommandRegistry,
} from "@xmux/chat-core";
import type { MessageCreateOptions } from "discord.js";
import {
  createDiscordCommandEvent,
  createDiscordInvalidCommandEvent,
  createDiscordUnknownCommandEvent,
  parseDiscordCommand,
  type DiscordChatInputInteractionLike,
} from "../commands";
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
import type { DiscordAdapterData, DiscordAdapterMode } from "../types";

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
  readonly logger: DiscordLogScope;
  readonly mode: DiscordAdapterMode;
}): void {
  args.client.onInteractionCreate(createInteractionHandler(args));

  if (args.mode.type === "gateway" && args.mode.observeMessages) {
    args.client.onMessageCreate(createIgnoredMessageHandler(args));
  }

  if (args.mode.type === "gateway" && args.mode.observeReactions) {
    const reactionHandler = createIgnoredReactionHandler(args);
    args.client.onReactionAdd(reactionHandler);
    args.client.onReactionRemove(reactionHandler);
  }
}

function createIgnoredMessageHandler<TCommands extends ChatCommandRegistry, TChatId extends string>(
  args: RegisterHandlerArgs<TCommands, TChatId>,
): DiscordMessageHandler {
  return () => {
    runGatewayHandler({
      ...args,
      eventType: "messageCreate",
      handle: async () => {
        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "messageCreate",
          reason: "not_implemented",
        });
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
        if (!isChatInputCommandInteraction(interaction)) {
          args.logger.debug(discordLogEvents.inboundIgnored, {
            eventType: "interactionCreate",
            reason: "unsupported_interaction",
          });
          return;
        }

        await interaction.deferReply();

        const conversationId = interaction.channelId;
        const actor = createDiscordInteractionActor(interaction);
        args.interactionRegistry.put({
          interactionId: interaction.id,
          channelId: conversationId,
          guildId: interaction.guildId ?? undefined,
          createdAt: Date.now(),
          editReply: async (payload) =>
            encodeInteractionSentMessage({
              message: await interaction.editReply(payload),
              fallbackChannelId: conversationId,
              fallbackGuildId: interaction.guildId ?? undefined,
            }),
          followUp: async (payload) =>
            encodeInteractionSentMessage({
              message: await interaction.followUp(payload),
              fallbackChannelId: conversationId,
              fallbackGuildId: interaction.guildId ?? undefined,
            }),
        });

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
      },
    });
  };
}

function createIgnoredReactionHandler<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: RegisterHandlerArgs<TCommands, TChatId>): DiscordReactionHandler {
  return () => {
    runGatewayHandler({
      ...args,
      eventType: "messageReaction",
      handle: async () => {
        args.logger.debug(discordLogEvents.inboundIgnored, {
          eventType: "messageReaction",
          reason: "not_implemented",
        });
      },
    });
  };
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

interface DiscordChatInputInteractionRuntime extends DiscordChatInputInteractionLike {
  readonly id: string;
  readonly channelId: string;
  readonly guildId?: string | null;
  readonly user?: {
    readonly id?: string;
    readonly username?: string;
    readonly globalName?: string | null;
    readonly bot?: boolean;
  };
  isChatInputCommand(): boolean;
  deferReply(): Promise<unknown>;
  editReply(payload: string | MessageCreateOptions): Promise<unknown>;
  followUp(payload: string | MessageCreateOptions): Promise<unknown>;
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

function createDiscordInteractionActor(
  interaction: DiscordChatInputInteractionRuntime,
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
