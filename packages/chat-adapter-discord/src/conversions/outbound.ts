import { Result } from "better-result";
import type {
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatSentMessage,
} from "@xmux/chat-core";
import type { APIAllowedMentions } from "discord-api-types/v10";
import type { MessageCreateOptions, MessageMentionOptions } from "discord.js";
import type {
  DiscordCreateThreadRequest,
  DiscordSendMessageRequest,
  DiscordSendTypingRequest,
  DiscordSentMessage,
} from "../client";
import { DiscordFormattingError, DiscordReplyError, DiscordSendMessageError } from "../errors";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";
import { formatDiscordText } from "./formatting";

export const discordContentLimit = 2_000;
const defaultThreadName = "xmux reply";

type DiscordSendMessagePayload = Omit<DiscordSendMessageRequest, "signal">;
type DiscordSendTypingPayload = Omit<DiscordSendTypingRequest, "signal">;
type DiscordCreateThreadPayload = Omit<DiscordCreateThreadRequest, "signal">;

type DiscordReplyMessagePayload =
  | {
      readonly kind: "message";
      readonly message: DiscordSendMessagePayload;
    }
  | {
      readonly kind: "thread";
      readonly thread: DiscordCreateThreadPayload;
      readonly message: Omit<DiscordSendMessagePayload, "channelId">;
    };

export function encodeDiscordSendMessage(
  input: ChatAdapterSendMessageInput<string, DiscordAdapterOptions>,
  defaults: { readonly allowedMentions: APIAllowedMentions },
): Result<DiscordSendMessagePayload, DiscordSendMessageError> {
  return Result.gen(function* () {
    const content = yield* Result.mapError(
      encodeDiscordText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new DiscordSendMessageError({ cause }),
    );

    return Result.ok({
      channelId: input.conversationId,
      payload: encodeDiscordMessagePayload({
        content,
        adapterOptions: input.adapterOptions,
        defaults,
      }),
    });
  });
}

export function encodeDiscordReplyMessage(
  input: ChatAdapterReplyInput<string, DiscordAdapterOptions>,
  defaults: { readonly allowedMentions: APIAllowedMentions },
): Result<DiscordReplyMessagePayload, DiscordReplyError> {
  return Result.gen(function* () {
    const content = yield* Result.mapError(
      encodeDiscordText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new DiscordReplyError({ cause }),
    );
    const mode = input.mode ?? "auto";
    const basePayload = encodeDiscordMessagePayload({
      content,
      adapterOptions: input.adapterOptions,
      defaults,
    });

    if (mode === "conversation") {
      return Result.ok({
        kind: "message",
        message: { channelId: input.conversationId, payload: basePayload },
      } satisfies DiscordReplyMessagePayload);
    }

    if (mode === "thread") {
      if (input.message === undefined || input.message.messageId.trim().length === 0) {
        return Result.ok({
          kind: "message",
          message: { channelId: input.conversationId, payload: basePayload },
        } satisfies DiscordReplyMessagePayload);
      }

      return Result.ok({
        kind: "thread",
        thread: {
          channelId: input.conversationId,
          messageId: input.message.messageId,
          name: normalizeThreadName(input.adapterOptions.threadName),
        },
        message: { payload: basePayload },
      } satisfies DiscordReplyMessagePayload);
    }

    const messageId = input.message?.messageId;
    if (messageId === undefined || messageId.trim().length === 0) {
      return mode === "auto"
        ? Result.ok({
            kind: "message",
            message: { channelId: input.conversationId, payload: basePayload },
          } satisfies DiscordReplyMessagePayload)
        : Result.err(
            new DiscordReplyError({ reason: "Discord quote replies require a message id" }),
          );
    }

    return Result.ok({
      kind: "message",
      message: {
        channelId: input.conversationId,
        payload: {
          ...basePayload,
          reply: { messageReference: messageId, failIfNotExists: false },
        },
      },
    } satisfies DiscordReplyMessagePayload);
  });
}

export function encodeDiscordSendTyping(
  input: ChatAdapterSendTypingInput<string, DiscordAdapterOptions>,
): DiscordSendTypingPayload {
  return { channelId: input.conversationId };
}

export function encodeDiscordSentMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly text: string;
  readonly format?: ChatAdapterSendMessageInput<TChatId, DiscordAdapterOptions>["format"];
  readonly discordMessage: DiscordSentMessage;
}): ChatSentMessage<TChatId, DiscordAdapterData> {
  return {
    chatId: args.chatId,
    conversationId: args.discordMessage.channelId,
    messageId: args.discordMessage.messageId,
    text: args.text,
    format: args.format,
    adapterData: {
      discordGuildId: args.discordMessage.guildId,
      discordChannelId: args.discordMessage.channelId,
      discordMessageId: args.discordMessage.messageId,
      raw: args.discordMessage.raw,
    },
  };
}

export function encodeDiscordText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
}): Result<string, DiscordFormattingError> {
  const formatted = formatDiscordText(args);

  return Result.andThen(formatted, (content) =>
    content.length > discordContentLimit
      ? Result.err(
          new DiscordFormattingError({
            reason: `Discord message content exceeds ${discordContentLimit} characters`,
          }),
        )
      : Result.ok(content),
  );
}

export function encodeDiscordMessagePayload(args: {
  readonly content: string;
  readonly adapterOptions: DiscordAdapterOptions;
  readonly defaults: { readonly allowedMentions: APIAllowedMentions };
}): MessageCreateOptions {
  return {
    content: args.content,
    allowedMentions: encodeAllowedMentions({
      defaults: args.defaults.allowedMentions,
      configured: args.adapterOptions.allowedMentions,
      replyMention: args.adapterOptions.replyMention,
    }),
    ...(args.adapterOptions.flags === undefined ? {} : { flags: args.adapterOptions.flags }),
  };
}

function encodeAllowedMentions(args: {
  readonly defaults: APIAllowedMentions;
  readonly configured?: APIAllowedMentions;
  readonly replyMention?: boolean;
}): MessageMentionOptions {
  const merged = { ...args.defaults, ...args.configured };
  const repliedUser = args.replyMention ?? merged.replied_user;

  return {
    ...(merged.parse === undefined ? {} : { parse: merged.parse }),
    ...(merged.roles === undefined ? {} : { roles: merged.roles }),
    ...(merged.users === undefined ? {} : { users: merged.users }),
    ...(repliedUser === undefined ? {} : { repliedUser }),
  };
}

function normalizeThreadName(threadName: string | undefined): string {
  const trimmed = threadName?.trim();
  return trimmed === undefined || trimmed.length === 0 ? defaultThreadName : trimmed;
}
