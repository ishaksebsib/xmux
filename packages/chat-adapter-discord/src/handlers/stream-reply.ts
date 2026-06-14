import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient, DiscordSentMessage } from "../client";
import type { DiscordAdapterConfig } from "../config";
import {
  encodeDiscordMessagePayload,
  encodeDiscordReplyMessage,
  encodeDiscordSentMessage,
} from "../conversions/outbound";
import { encodeDiscordStreamText, streamDiscordTextByEditing } from "../conversions/streaming";
import { DiscordStreamReplyError } from "../errors";
import {
  parseDiscordInteractionMessageId,
  type DiscordInteractionRegistry,
} from "../stores/interaction-registry";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";
import { editDiscordStreamMessage } from "./stream-message";

export async function streamReply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions" | "stream">;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly input: ChatAdapterStreamReplyInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordStreamReplyError>> {
  return Result.gen(async function* () {
    const placeholder = yield* Result.mapError(
      encodeDiscordStreamText({
        text: args.config.stream.placeholderText,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
      }),
      (cause) => new DiscordStreamReplyError({ cause }),
    );

    const initial = yield* Result.await(sendInitialStreamReply({ ...args, placeholder }));
    let discordMessage = initial.discordMessage;

    const streamed = yield* Result.await(
      streamDiscordTextByEditing({
        chunks: args.input.content.chunks,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
        initialFlushedText: args.config.stream.placeholderText,
        editIntervalMs: args.config.stream.editIntervalMs,
        signal: args.input.signal,
        createError: ({ reason, cause }) => new DiscordStreamReplyError({ reason, cause }),
        edit: async (content) => {
          discordMessage = await initial.edit({ content, discordMessage });
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

function sendInitialStreamReply<TChatId extends string>(args: {
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly input: ChatAdapterStreamReplyInput<TChatId, DiscordAdapterOptions>;
  readonly placeholder: string;
}): Promise<Result<InitialStreamReply, DiscordStreamReplyError>> {
  return Result.gen(async function* () {
    const interactionId =
      args.input.message === undefined
        ? undefined
        : parseDiscordInteractionMessageId(args.input.message.messageId);
    const interactionContext =
      interactionId === undefined ? undefined : args.interactionRegistry.get(interactionId);

    if (interactionId !== undefined && interactionContext !== undefined) {
      args.interactionRegistry.markInitialResponseUsed(interactionId);
      const discordMessage = yield* Result.await(
        Result.tryPromise({
          try: () =>
            interactionContext.editReply(
              encodeDiscordMessagePayload({
                content: args.placeholder,
                adapterOptions: args.input.adapterOptions,
                defaults: { allowedMentions: args.config.defaultAllowedMentions },
              }),
            ),
          catch: (cause) => new DiscordStreamReplyError({ cause }),
        }),
      );
      return Result.ok({
        discordMessage,
        edit: async ({ content }) =>
          interactionContext.editReply(
            encodeDiscordMessagePayload({
              content,
              adapterOptions: args.input.adapterOptions,
              defaults: { allowedMentions: args.config.defaultAllowedMentions },
            }),
          ),
      } satisfies InitialStreamReply);
    }

    const input =
      interactionId === undefined ? args.input : ({ ...args.input, mode: "conversation" } as const);
    const encoded = yield* Result.mapError(
      encodeDiscordReplyMessage(
        {
          ...input,
          text: args.placeholder,
          format: args.input.content.format,
        },
        { allowedMentions: args.config.defaultAllowedMentions },
      ),
      (cause) => new DiscordStreamReplyError({ cause }),
    );

    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          if (encoded.kind === "message") {
            return args.client.sendMessage({ ...encoded.message, signal: args.input.signal });
          }

          const thread = await args.client.createMessageThread({
            ...encoded.thread,
            signal: args.input.signal,
          });
          return args.client.sendMessage({
            ...encoded.message,
            channelId: thread.channelId,
            signal: args.input.signal,
          });
        },
        catch: (cause) => new DiscordStreamReplyError({ cause }),
      }),
    );

    return Result.ok({
      discordMessage,
      edit: ({ content, discordMessage: message }) =>
        editDiscordStreamMessage({
          client: args.client,
          discordMessage: message,
          content,
          adapterOptions: args.input.adapterOptions,
          config: args.config,
          signal: args.input.signal,
        }),
    } satisfies InitialStreamReply);
  });
}

interface InitialStreamReply {
  readonly discordMessage: DiscordSentMessage;
  edit(args: {
    readonly content: string;
    readonly discordMessage: DiscordSentMessage;
  }): Promise<DiscordSentMessage>;
}
