import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient, DiscordSentMessage } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordMessagePayload, encodeDiscordSentMessage } from "../conversions/outbound";
import { encodeDiscordStreamText, streamDiscordTextByEditing } from "../conversions/streaming";
import { DiscordStreamMessageError } from "../errors";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function streamMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions" | "stream">;
  readonly input: ChatAdapterStreamMessageInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordStreamMessageError>> {
  return Result.gen(async function* () {
    const placeholder = yield* Result.mapError(
      encodeDiscordStreamText({
        text: args.config.stream.placeholderText,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
      }),
      (cause) => new DiscordStreamMessageError({ cause }),
    );

    let discordMessage = yield* Result.await(
      Result.tryPromise({
        try: () =>
          args.client.sendMessage({
            channelId: args.input.conversationId,
            payload: encodeDiscordMessagePayload({
              content: placeholder,
              adapterOptions: args.input.adapterOptions,
              defaults: { allowedMentions: args.config.defaultAllowedMentions },
            }),
            signal: args.input.signal,
          }),
        catch: (cause) => new DiscordStreamMessageError({ cause }),
      }),
    );

    const streamed = yield* Result.await(
      streamDiscordTextByEditing({
        chunks: args.input.content.chunks,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
        initialFlushedText: args.config.stream.placeholderText,
        editIntervalMs: args.config.stream.editIntervalMs,
        signal: args.input.signal,
        createError: ({ reason, cause }) => new DiscordStreamMessageError({ reason, cause }),
        edit: async (content) => {
          discordMessage = await editDiscordStreamMessage({
            client: args.client,
            discordMessage,
            content,
            adapterOptions: args.input.adapterOptions,
            config: args.config,
            signal: args.input.signal,
          });
        },
      }),
    );

    return Result.ok(
      encodeDiscordSentMessage({
        chatId: args.chatId,
        text: streamed.text,
        format: args.input.content.format,
        discordMessage,
      }),
    );
  });
}

export async function editDiscordStreamMessage(args: {
  readonly client: DiscordBotClient;
  readonly discordMessage: DiscordSentMessage;
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
    channelId: args.discordMessage.channelId,
    messageId: args.discordMessage.messageId,
    payload: { content: payload.content, allowedMentions: payload.allowedMentions },
    signal: args.signal,
  });
}
