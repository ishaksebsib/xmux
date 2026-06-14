import type { DiscordBotClient, DiscordSentMessage } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordMessagePayload } from "../conversions/outbound";
import type { DiscordAdapterOptions } from "../types";

export async function sendDiscordStreamSegment(args: {
  readonly client: DiscordBotClient;
  readonly conversationId: string;
  readonly content: string;
  readonly adapterOptions: DiscordAdapterOptions;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly signal?: AbortSignal;
}): Promise<DiscordSentMessage> {
  return args.client.sendMessage({
    channelId: args.conversationId,
    payload: encodeDiscordMessagePayload({
      content: args.content,
      adapterOptions: args.adapterOptions,
      defaults: { allowedMentions: args.config.defaultAllowedMentions },
    }),
    signal: args.signal,
  });
}

export async function editDiscordStreamSegment(args: {
  readonly client: DiscordBotClient;
  readonly message: DiscordSentMessage;
  readonly content: string;
  readonly adapterOptions: DiscordAdapterOptions;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly signal?: AbortSignal;
}): Promise<DiscordSentMessage> {
  const payload = encodeDiscordMessagePayload({
    content: args.content,
    adapterOptions: args.adapterOptions,
    defaults: { allowedMentions: args.config.defaultAllowedMentions },
  });

  return args.client.editMessage({
    channelId: args.message.channelId,
    messageId: args.message.messageId,
    payload: { content: payload.content, allowedMentions: payload.allowedMentions },
    signal: args.signal,
  });
}

export async function deleteDiscordStreamSegment(args: {
  readonly client: DiscordBotClient;
  readonly message: DiscordSentMessage;
  readonly signal?: AbortSignal;
}): Promise<void> {
  await args.client.deleteMessage({
    channelId: args.message.channelId,
    messageId: args.message.messageId,
    signal: args.signal,
  });
}
