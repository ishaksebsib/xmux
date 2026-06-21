import { Result } from "better-result";
import type { ChatAdapterUpdateActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { APIAllowedMentions } from "discord-api-types/v10";
import type { DiscordBotClient } from "../client";
import { encodeDiscordActionUpdate } from "../conversions/actions";
import { encodeDiscordSentMessage } from "../conversions/outbound";
import { DiscordUpdateActionError } from "../errors";
import type { DiscordActionStore, DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function updateAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly defaults: {
    readonly allowedMentions: APIAllowedMentions;
    readonly actionStore?: DiscordActionStore;
  };
  readonly input: ChatAdapterUpdateActionInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordUpdateActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(encodeDiscordActionUpdate(args.input, args.defaults));

    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: () =>
          args.client.editMessage({
            channelId: args.input.conversationId,
            messageId: args.input.message.messageId,
            payload: request.edit,
            signal: args.input.signal,
          }),
        catch: (cause) => new DiscordUpdateActionError({ cause }),
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
