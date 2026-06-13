import type { ChatActor, ChatAdapterMessageEvent } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterError } from "../errors";
import type { DiscordAdapterData } from "../types";
import { decodeDiscordAttachments } from "./attachments";

export type DiscordInboundDecodeResult<TEvent> =
  | { readonly status: "event"; readonly event: TEvent }
  | {
      readonly status: "ignored";
      readonly reason: "self_message" | "bot_message" | "malformed_message";
    };

export interface DiscordMessageLike {
  readonly id?: string;
  readonly channelId?: string;
  readonly guildId?: string | null;
  readonly content?: string | null;
  readonly author?: DiscordUserLike | null;
  readonly attachments?: unknown;
}

export interface DiscordUserLike {
  readonly id?: string;
  readonly username?: string;
  readonly globalName?: string | null;
  readonly bot?: boolean;
}

export function decodeDiscordMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: Pick<DiscordBotClient, "downloadAttachment">;
  readonly message: unknown;
  readonly botUserId?: string;
}): DiscordInboundDecodeResult<
  ChatAdapterMessageEvent<TChatId, DiscordAdapterData, DiscordAdapterError>
> {
  if (!isDiscordMessageLike(args.message)) {
    return { status: "ignored", reason: "malformed_message" };
  }

  const author = args.message.author;
  if (author?.id !== undefined && args.botUserId !== undefined && author.id === args.botUserId) {
    return { status: "ignored", reason: "self_message" };
  }

  if (author?.bot === true) {
    return { status: "ignored", reason: "bot_message" };
  }

  const guildId = args.message.guildId ?? undefined;
  const conversation = {
    chatId: args.chatId,
    conversationId: args.message.channelId,
  };
  const adapterData: DiscordAdapterData = {
    discordGuildId: guildId,
    discordChannelId: args.message.channelId,
    discordMessageId: args.message.id,
    ...(author?.id === undefined ? {} : { discordUserId: author.id }),
    raw: args.message,
  };

  return {
    status: "event",
    event: {
      type: "message",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: args.message.id,
        text: args.message.content ?? "",
        format: "plain",
        actor: decodeDiscordActor({ user: author, channelId: args.message.channelId, adapterData }),
        attachments: decodeDiscordAttachments({
          client: args.client,
          channelId: args.message.channelId,
          guildId,
          messageId: args.message.id,
          attachments: args.message.attachments,
        }),
        adapterData,
      },
    },
  };
}

export function decodeDiscordActor(args: {
  readonly user?: DiscordUserLike | null;
  readonly channelId: string;
  readonly interactionId?: string;
  readonly adapterData?: DiscordAdapterData;
}): ChatActor<DiscordAdapterData> {
  const user = args.user;
  const adapterData =
    args.adapterData ??
    ({
      discordChannelId: args.channelId,
      ...(args.interactionId === undefined ? {} : { discordInteractionId: args.interactionId }),
      ...(user?.id === undefined ? {} : { discordUserId: user.id }),
      raw: user ?? {},
    } satisfies DiscordAdapterData);

  if (user?.id === undefined) {
    return {
      kind: "system",
      adapterData,
    };
  }

  return {
    kind: user.bot === true ? "bot" : "user",
    actorId: user.id,
    displayName: user.globalName ?? user.username,
    adapterData,
  };
}

function isDiscordMessageLike(
  value: unknown,
): value is Required<Pick<DiscordMessageLike, "id" | "channelId">> & DiscordMessageLike {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.channelId === "string" &&
    value.channelId.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
