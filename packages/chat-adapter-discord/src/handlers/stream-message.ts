import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordMessagePayload, encodeDiscordSentMessage } from "../conversions/outbound";
import { encodeDiscordStreamText, streamDiscordTextBySegments } from "../conversions/streaming";
import { DiscordStreamMessageError } from "../errors";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";
import { createDiscordStreamOutput } from "./stream-output";
import {
  deleteDiscordStreamSegment,
  editDiscordStreamSegment,
  sendDiscordStreamSegment,
} from "./stream-segments";

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

    const initialMessage = yield* Result.await(
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

    const output = createDiscordStreamOutput({
      initialMessage,
      initialContent: placeholder,
      editSegment: ({ message, content }) =>
        editDiscordStreamSegment({
          client: args.client,
          message,
          content,
          adapterOptions: args.input.adapterOptions,
          config: args.config,
          signal: args.input.signal,
        }),
      sendSegment: ({ content }) =>
        sendDiscordStreamSegment({
          client: args.client,
          conversationId: args.input.conversationId,
          content,
          adapterOptions: args.input.adapterOptions,
          config: args.config,
          signal: args.input.signal,
        }),
      deleteSegment: ({ message }) =>
        deleteDiscordStreamSegment({ client: args.client, message, signal: args.input.signal }),
    });

    const streamed = yield* Result.await(
      streamDiscordTextBySegments({
        chunks: args.input.content.chunks,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
        initialFlushedText: args.config.stream.placeholderText,
        editIntervalMs: args.config.stream.editIntervalMs,
        signal: args.input.signal,
        createError: ({ reason, cause }) => new DiscordStreamMessageError({ reason, cause }),
        reconcile: async (segments) => {
          await output.reconcile(segments);
        },
      }),
    );

    return Result.ok(
      encodeDiscordSentMessage({
        chatId: args.chatId,
        text: streamed.text,
        format: args.input.content.format,
        discordMessage: output.lastMessage,
      }),
    );
  });
}
