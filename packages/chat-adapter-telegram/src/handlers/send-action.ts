import { Result } from "better-result";
import type { ChatAdapterSendActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramSendAction } from "../conversions/actions";
import { encodeTelegramSentMessage } from "../conversions/outbound";
import { TelegramSendActionError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export async function sendAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterSendActionInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramSendActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.try({
      try: () => encodeTelegramSendAction(args.input),
      catch: (cause) =>
        TelegramSendActionError.is(cause) ? cause : new TelegramSendActionError({ cause }),
    });

    const telegramMessage = yield* Result.await(
      Result.tryPromise({
        try: () => args.bot.sendMessage(request),
        catch: (cause) => new TelegramSendActionError({ cause }),
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
