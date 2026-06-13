import type { MessageCreateOptions } from "discord.js";
import type { DiscordSentMessage } from "../client";

const defaultInteractionTtlMs = 14 * 60 * 1_000;

export interface DiscordInteractionContext {
  readonly interactionId: string;
  readonly channelId: string;
  readonly guildId?: string;
  readonly createdAt: number;
  editReply(payload: string | MessageCreateOptions): Promise<DiscordSentMessage>;
  followUp(payload: string | MessageCreateOptions): Promise<DiscordSentMessage>;
}

export interface DiscordInteractionRegistry {
  put(context: DiscordInteractionContext): void;
  get(interactionId: string): DiscordInteractionContext | undefined;
  markInitialResponseUsed(interactionId: string): boolean;
  delete(interactionId: string): void;
  sweep(now?: number): void;
}

export function createDiscordInteractionRegistry(
  args: {
    readonly ttlMs?: number;
  } = {},
): DiscordInteractionRegistry {
  const ttlMs = args.ttlMs ?? defaultInteractionTtlMs;
  const contexts = new Map<
    string,
    { readonly context: DiscordInteractionContext; initialResponseUsed: boolean }
  >();

  return {
    put(context) {
      contexts.set(context.interactionId, { context, initialResponseUsed: false });
      this.sweep();
    },
    get(interactionId) {
      const entry = contexts.get(interactionId);
      if (entry === undefined) {
        return undefined;
      }

      if (Date.now() - entry.context.createdAt > ttlMs) {
        contexts.delete(interactionId);
        return undefined;
      }

      return entry.context;
    },
    markInitialResponseUsed(interactionId) {
      const entry = contexts.get(interactionId);
      if (entry === undefined || entry.initialResponseUsed) {
        return false;
      }

      entry.initialResponseUsed = true;
      return true;
    },
    delete(interactionId) {
      contexts.delete(interactionId);
    },
    sweep(now = Date.now()) {
      for (const [interactionId, entry] of contexts) {
        if (now - entry.context.createdAt > ttlMs) {
          contexts.delete(interactionId);
        }
      }
    },
  };
}

export function parseDiscordInteractionMessageId(messageId: string): string | undefined {
  const prefix = "discord-interaction:";
  return messageId.startsWith(prefix) ? messageId.slice(prefix.length) : undefined;
}
