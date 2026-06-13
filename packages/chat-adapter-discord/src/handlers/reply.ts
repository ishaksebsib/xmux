import { Result } from "better-result";
import type { ChatAdapterReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordReplyMessage, encodeDiscordSentMessage } from "../conversions/outbound";
import { DiscordReplyError } from "../errors";
import {
  parseDiscordInteractionMessageId,
  type DiscordInteractionRegistry,
} from "../stores/interaction-registry";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function reply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly input: ChatAdapterReplyInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordReplyError>> {
  return Result.gen(async function* () {
    const interactionId =
      args.input.message === undefined
        ? undefined
        : parseDiscordInteractionMessageId(args.input.message.messageId);
    const input =
      interactionId === undefined ? args.input : ({ ...args.input, mode: "conversation" } as const);
    const encoded = yield* encodeDiscordReplyMessage(input, {
      allowedMentions: args.config.defaultAllowedMentions,
    });

    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          const interactionContext =
            interactionId === undefined ? undefined : args.interactionRegistry.get(interactionId);

          if (
            interactionId !== undefined &&
            interactionContext !== undefined &&
            encoded.kind === "message"
          ) {
            return args.interactionRegistry.markInitialResponseUsed(interactionId)
              ? interactionContext.editReply(encoded.message.payload)
              : interactionContext.followUp(encoded.message.payload);
          }

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
        catch: (cause) => new DiscordReplyError({ cause }),
      }),
    );

    return Result.ok(
      encodeDiscordSentMessage({
        chatId: args.chatId,
        text: args.input.text,
        format: args.input.format,
        discordMessage,
      }),
    );
  });
}
