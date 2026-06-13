import { Result } from "better-result";
import type { ChatAdapterReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordReplyMessage, encodeDiscordSentMessage } from "../conversions/outbound";
import { DiscordReplyError } from "../errors";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function reply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly input: ChatAdapterReplyInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordReplyError>> {
  return Result.gen(async function* () {
    const encoded = yield* encodeDiscordReplyMessage(args.input, {
      allowedMentions: args.config.defaultAllowedMentions,
    });

    const request = yield* Result.await(
      Result.tryPromise({
        try: async () => {
          if (encoded.kind === "message") {
            return encoded.message;
          }

          const thread = await args.client.createMessageThread({
            ...encoded.thread,
            signal: args.input.signal,
          });
          return { ...encoded.message, channelId: thread.channelId };
        },
        catch: (cause) => new DiscordReplyError({ cause }),
      }),
    );

    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.client.sendMessage({ ...request, signal: args.input.signal }),
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
