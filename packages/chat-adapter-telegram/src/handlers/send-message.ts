import { Result } from "better-result";
import type { ChatAdapterSendMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramSendMessage, encodeTelegramSentMessage } from "../conversions/outbound";
import { TelegramSendMessageError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export async function sendMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterSendMessageInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendMessageError>> {
  return Result.gen(async function* () {
    const request = encodeTelegramSendMessage(args.input);
    const telegramMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.bot.sendMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new TelegramSendMessageError({ cause }),
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
