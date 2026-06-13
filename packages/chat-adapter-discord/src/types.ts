import type { ChatLogger } from "@xmux/chat-core";
import type { APIAllowedMentions } from "discord-api-types/v10";
import type { ClientOptions } from "discord.js";

/** Discord allowed-mentions payload. Defaults must avoid accidental pings. */
export type DiscordAllowedMentions = APIAllowedMentions;

/** Options forwarded to discord.js when the gateway client is created. */
export type DiscordClientOptions = ClientOptions;

/** Selects how Discord events are delivered. Gateway mode is the initial runtime target. */
export type DiscordAdapterMode =
  | {
      readonly type: "gateway";
      readonly observeMessages?: boolean;
      readonly observeReactions?: boolean;
      readonly requireMessageContentIntent?: boolean;
    }
  | {
      readonly type: "webhook";
      readonly publicKey: string;
    };

/** Controls Discord slash-command registration. */
export type DiscordCommandRegistrationMode =
  | { readonly scope: { readonly type: "none" } }
  | {
      readonly scope: { readonly type: "global" };
      readonly strategy?: "upsert" | "bulk-overwrite";
    }
  | {
      readonly scope: { readonly type: "guild"; readonly guildId: string };
      readonly strategy?: "upsert" | "bulk-overwrite";
    };

/** Per-call native Discord options. */
export type DiscordAdapterOptions = {
  readonly allowedMentions?: DiscordAllowedMentions;
  readonly flags?: number;
  readonly replyMention?: boolean;
  readonly threadName?: string;
};

/** Native Discord metadata kept opaque by chat-core. */
export type DiscordAdapterData = {
  readonly discordGuildId?: string;
  readonly discordChannelId: string;
  readonly discordMessageId?: string;
  readonly discordInteractionId?: string;
  readonly discordUserId?: string;
  readonly raw: unknown;
};

/** Edit-based streaming defaults for Discord message streams. */
export interface DiscordStreamOptions {
  readonly placeholderText?: string;
  readonly editIntervalMs?: number;
}

/** Stored button action payload used when Discord custom_id limits are exceeded. */
export interface DiscordActionEnvelope {
  readonly actionId: string;
  readonly value: string;
  readonly payload?: unknown;
}

/** Optional process-local or persistent store for Discord button action envelopes. */
export interface DiscordActionStore {
  get(key: string): DiscordActionEnvelope | undefined | Promise<DiscordActionEnvelope | undefined>;
  set(
    key: string,
    envelope: DiscordActionEnvelope,
    options?: { readonly ttlMs?: number },
  ): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
}

/** Configuration for creating a Discord chat adapter. */
export interface CreateDiscordAdapterOptions<TChatId extends string = "discord"> {
  readonly id?: TChatId;
  readonly token: string;
  readonly applicationId: string;
  readonly mode?: DiscordAdapterMode;
  readonly commandRegistration?: DiscordCommandRegistrationMode;
  readonly defaultAllowedMentions?: DiscordAllowedMentions;
  readonly actionStore?: DiscordActionStore;
  readonly stream?: DiscordStreamOptions;
  readonly clientOptions?: DiscordClientOptions;
  readonly logger?: ChatLogger;
}
