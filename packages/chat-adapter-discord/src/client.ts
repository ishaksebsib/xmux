import {
  Client,
  Events,
  GatewayIntentBits,
  IntentsBitField,
  Partials,
  REST,
  Routes,
  type ClientOptions,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { DiscordApplicationId, DiscordBotToken } from "./config";
import type { DiscordAdapterMode, DiscordClientOptions } from "./types";

export type DiscordMessageHandler = (message: Message) => void | Promise<void>;
export type DiscordInteractionHandler = (interaction: Interaction) => void | Promise<void>;
export type DiscordReactionHandler = (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) => void | Promise<void>;

export interface DiscordReadyInfo {
  readonly userId: string;
  readonly username?: string;
}

export interface DiscordSendMessageRequest {
  readonly channelId: string;
  readonly payload: string | MessageCreateOptions;
  readonly signal?: AbortSignal;
}

export interface DiscordEditMessageRequest {
  readonly channelId: string;
  readonly messageId: string;
  readonly payload: string | MessageEditOptions;
  readonly signal?: AbortSignal;
}

export interface DiscordCreateThreadRequest {
  readonly channelId: string;
  readonly messageId: string;
  readonly name: string;
  readonly signal?: AbortSignal;
}

export interface DiscordSendTypingRequest {
  readonly channelId: string;
  readonly signal?: AbortSignal;
}

export interface DiscordRegisterCommandsRequest {
  readonly applicationId: DiscordApplicationId;
  readonly scope:
    | { readonly type: "global" }
    | { readonly type: "guild"; readonly guildId: string };
  readonly commands: readonly RESTPostAPIApplicationCommandsJSONBody[];
  readonly signal?: AbortSignal;
}

export interface DiscordDownloadAttachmentRequest {
  readonly url: string;
  readonly signal?: AbortSignal;
}

export interface DiscordSentMessage {
  readonly channelId: string;
  readonly messageId: string;
  readonly guildId?: string;
  readonly raw: unknown;
}

export interface DiscordThreadInfo {
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly guildId?: string;
  readonly raw: unknown;
}

export interface DiscordBotClient {
  login(token: DiscordBotToken): Promise<void>;
  destroy(): void;
  getBotUserId(): string | undefined;
  onReady(handler: (info: DiscordReadyInfo) => void): void;
  onError(handler: (error: unknown) => void): void;
  onMessageCreate(handler: DiscordMessageHandler): void;
  onInteractionCreate(handler: DiscordInteractionHandler): void;
  onReactionAdd(handler: DiscordReactionHandler): void;
  onReactionRemove(handler: DiscordReactionHandler): void;
  sendMessage(input: DiscordSendMessageRequest): Promise<DiscordSentMessage>;
  editMessage(input: DiscordEditMessageRequest): Promise<DiscordSentMessage>;
  createMessageThread(input: DiscordCreateThreadRequest): Promise<DiscordThreadInfo>;
  sendTyping(input: DiscordSendTypingRequest): Promise<void>;
  registerCommands(input: DiscordRegisterCommandsRequest): Promise<void>;
  downloadAttachment(input: DiscordDownloadAttachmentRequest): Promise<Response>;
}

export type CreateDiscordBotClient = (args: {
  readonly token: DiscordBotToken;
  readonly mode: DiscordAdapterMode;
  readonly options?: DiscordClientOptions;
}) => DiscordBotClient;

export function createDiscordBotClient(args: {
  readonly token: DiscordBotToken;
  readonly mode: DiscordAdapterMode;
  readonly options?: DiscordClientOptions;
}): DiscordBotClient {
  const client = new Client(createClientOptions(args.mode, args.options));
  const rest = new REST({ version: "10" }).setToken(args.token);

  return {
    login: async (token) => {
      rest.setToken(token);
      await client.login(token);
    },
    destroy: () => {
      client.destroy();
    },
    getBotUserId: () => client.user?.id,
    onReady: (handler) => {
      client.on(Events.ClientReady, (readyClient) => {
        handler({ userId: readyClient.user.id, username: readyClient.user.username });
      });
    },
    onError: (handler) => {
      client.on(Events.Error, handler);
      client.on(Events.ShardError, handler);
    },
    onMessageCreate: (handler) => {
      client.on(Events.MessageCreate, handler);
    },
    onInteractionCreate: (handler) => {
      client.on(Events.InteractionCreate, handler);
    },
    onReactionAdd: (handler) => {
      client.on(Events.MessageReactionAdd, handler);
    },
    onReactionRemove: (handler) => {
      client.on(Events.MessageReactionRemove, handler);
    },
    sendMessage: async (input) => {
      const channel = await fetchSendableChannel(client, input.channelId);
      const message = await channel.send(input.payload);
      return encodeSentMessage(message);
    },
    editMessage: async (input) => {
      const channel = await fetchMessageChannel(client, input.channelId);
      const message = await channel.messages.fetch(input.messageId);
      const edited = await message.edit(input.payload);
      return encodeSentMessage(edited);
    },
    createMessageThread: async (input) => {
      const channel = await fetchMessageChannel(client, input.channelId);
      const message = await channel.messages.fetch(input.messageId);
      const thread = await message.startThread({ name: input.name });
      return {
        channelId: thread.id,
        parentChannelId: thread.parentId ?? input.channelId,
        guildId: thread.guildId ?? undefined,
        raw: thread,
      };
    },
    sendTyping: async (input) => {
      const channel = await fetchTypingChannel(client, input.channelId);
      await channel.sendTyping();
    },
    registerCommands: async (input) => {
      const route =
        input.scope.type === "guild"
          ? Routes.applicationGuildCommands(input.applicationId, input.scope.guildId)
          : Routes.applicationCommands(input.applicationId);

      await rest.put(route, {
        body: input.commands,
        signal: input.signal,
      } as Parameters<REST["put"]>[1]);
    },
    downloadAttachment: (input) => fetch(input.url, { signal: input.signal }),
  };
}

function createClientOptions(
  mode: DiscordAdapterMode,
  options: DiscordClientOptions | undefined,
): ClientOptions {
  const partials = mergePartials(defaultPartialsForMode(mode), options?.partials);
  const clientOptions = {
    ...options,
    intents: mergeIntents(defaultIntentsForMode(mode), options?.intents),
  } satisfies ClientOptions;

  return partials === undefined ? clientOptions : { ...clientOptions, partials };
}

function mergeIntents(
  defaults: readonly GatewayIntentBits[],
  configured: ClientOptions["intents"] | undefined,
): ClientOptions["intents"] {
  if (configured === undefined) {
    return defaults;
  }

  return new IntentsBitField(configured).add(...defaults).bitfield;
}

function defaultIntentsForMode(mode: DiscordAdapterMode): readonly GatewayIntentBits[] {
  const intents = new Set<GatewayIntentBits>([GatewayIntentBits.Guilds]);

  if (mode.type === "gateway" && (mode.observeMessages || mode.requireMessageContentIntent)) {
    intents.add(GatewayIntentBits.GuildMessages);
    intents.add(GatewayIntentBits.DirectMessages);
    intents.add(GatewayIntentBits.MessageContent);
  }

  if (mode.type === "gateway" && mode.observeReactions) {
    intents.add(GatewayIntentBits.GuildMessageReactions);
    intents.add(GatewayIntentBits.DirectMessageReactions);
  }

  return [...intents];
}

function defaultPartialsForMode(mode: DiscordAdapterMode): readonly Partials[] {
  const partials = new Set<Partials>();

  if (mode.type === "gateway" && (mode.observeMessages || mode.requireMessageContentIntent)) {
    partials.add(Partials.Channel);
  }

  if (mode.type === "gateway" && mode.observeReactions) {
    partials.add(Partials.Channel);
    partials.add(Partials.Message);
    partials.add(Partials.Reaction);
  }

  return [...partials];
}

function mergePartials(
  defaults: readonly Partials[],
  configured: ClientOptions["partials"] | undefined,
): readonly Partials[] | undefined {
  if (configured === undefined) {
    return defaults.length === 0 ? undefined : defaults;
  }

  return [...new Set([...defaults, ...configured])];
}

async function fetchSendableChannel(client: Client, channelId: string): Promise<SendableChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!isSendableChannel(channel)) {
    throw new Error(`Discord channel ${channelId} cannot send messages`);
  }
  return channel;
}

async function fetchMessageChannel(client: Client, channelId: string): Promise<MessageChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!isMessageChannel(channel)) {
    throw new Error(`Discord channel ${channelId} does not expose messages`);
  }
  return channel;
}

async function fetchTypingChannel(client: Client, channelId: string): Promise<TypingChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!isTypingChannel(channel)) {
    throw new Error(`Discord channel ${channelId} cannot send typing indicators`);
  }
  return channel;
}

type SendableChannel = {
  send(payload: string | MessageCreateOptions): Promise<Message>;
};

type MessageChannel = {
  readonly messages: {
    fetch(messageId: string): Promise<Message>;
  };
};

type TypingChannel = {
  sendTyping(): Promise<void>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return isRecord(channel) && typeof channel.send === "function";
}

function isMessageChannel(channel: unknown): channel is MessageChannel {
  return (
    isRecord(channel) && isRecord(channel.messages) && typeof channel.messages.fetch === "function"
  );
}

function isTypingChannel(channel: unknown): channel is TypingChannel {
  return isRecord(channel) && typeof channel.sendTyping === "function";
}

function encodeSentMessage(message: Message): DiscordSentMessage {
  return {
    channelId: message.channelId,
    messageId: message.id,
    guildId: message.guildId ?? undefined,
    raw: message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
