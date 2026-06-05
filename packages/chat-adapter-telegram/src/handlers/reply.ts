import { Result } from "better-result";
import type { ChatAdapterReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramReplyMessage, encodeTelegramSentMessage } from "../conversions/outbound";
import { TelegramReplyError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export async function reply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterReplyInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramReplyError>> {
  return Result.gen(async function* () {
    const request = yield* encodeTelegramReplyMessage(args.input);

    const telegramMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.bot.sendMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new TelegramReplyError({ cause }),
      }),
    );

    return Result.ok(
      encodeTelegramSentMessage({
        chatId: args.chatId,
        conversationId: args.input.conversationId,
        text: args.input.text,
        format: args.input.format,
        telegramMessage,
      }),
    );
  });
}
