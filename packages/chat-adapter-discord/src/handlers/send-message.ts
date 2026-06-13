import { Result } from "better-result";
import type { ChatAdapterSendMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordSendMessage, encodeDiscordSentMessage } from "../conversions/outbound";
import { DiscordSendMessageError } from "../errors";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function sendMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions">;
  readonly input: ChatAdapterSendMessageInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordSendMessageError>> {
  return Result.gen(async function* () {
    const request = yield* encodeDiscordSendMessage(args.input, {
      allowedMentions: args.config.defaultAllowedMentions,
    });
    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.client.sendMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new DiscordSendMessageError({ cause }),
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
