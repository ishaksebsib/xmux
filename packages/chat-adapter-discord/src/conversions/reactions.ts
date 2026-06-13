import type { ChatReactionAddedEvent, ChatReactionRemovedEvent } from "@xmux/chat-core";
import { decodeDiscordActor, type DiscordUserLike } from "./inbound";

export type DiscordReactionDecodeResult<TChatId extends string> =
  | {
      readonly status: "event";
      readonly event: ChatReactionAddedEvent<TChatId> | ChatReactionRemovedEvent<TChatId>;
    }
  | {
      readonly status: "ignored";
      readonly reason: "self_reaction" | "bot_reaction" | "malformed_reaction";
    };

export function decodeDiscordReaction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly type: "reaction.added" | "reaction.removed";
  readonly reaction: unknown;
  readonly user: unknown;
  readonly botUserId?: string;
}): DiscordReactionDecodeResult<TChatId> {
  if (!isDiscordUserLike(args.user)) {
    return { status: "ignored", reason: "malformed_reaction" };
  }

  if (args.botUserId !== undefined && args.user.id === args.botUserId) {
    return { status: "ignored", reason: "self_reaction" };
  }

  if (args.user.bot === true) {
    return { status: "ignored", reason: "bot_reaction" };
  }

  const message = readReactionMessage(args.reaction);
  if (message === undefined) {
    return { status: "ignored", reason: "malformed_reaction" };
  }

  const reaction = stringifyDiscordEmoji(readReactionEmoji(args.reaction));
  if (reaction === undefined) {
    return { status: "ignored", reason: "malformed_reaction" };
  }

  return {
    status: "event",
    event: {
      type: args.type,
      chatId: args.chatId,
      message: {
        chatId: args.chatId,
        conversationId: message.channelId,
        messageId: message.id,
      },
      actor: decodeDiscordActor({ user: args.user, channelId: message.channelId }),
      reaction,
    },
  };
}

function readReactionMessage(
  value: unknown,
): { readonly id: string; readonly channelId: string } | undefined {
  if (!isRecord(value) || !isRecord(value.message)) {
    return undefined;
  }

  const message = value.message;
  return typeof message.id === "string" &&
    message.id.length > 0 &&
    typeof message.channelId === "string" &&
    message.channelId.length > 0
    ? { id: message.id, channelId: message.channelId }
    : undefined;
}

function readReactionEmoji(value: unknown): unknown {
  return isRecord(value) ? value.emoji : undefined;
}

function stringifyDiscordEmoji(emoji: unknown): string | undefined {
  if (!isRecord(emoji)) {
    return undefined;
  }

  const id = typeof emoji.id === "string" ? emoji.id : undefined;
  const name = typeof emoji.name === "string" ? emoji.name : undefined;
  const animated = emoji.animated === true;

  if (id !== undefined && name !== undefined) {
    return `<${animated ? "a" : ""}:${name}:${id}>`;
  }

  return name;
}

function isDiscordUserLike(
  value: unknown,
): value is Required<Pick<DiscordUserLike, "id">> & DiscordUserLike {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
