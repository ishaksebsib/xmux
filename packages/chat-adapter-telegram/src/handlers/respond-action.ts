import { Result } from "better-result";
import type { ChatAdapterRespondToActionInput } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramActionResponse } from "../conversions/actions";
import { TelegramActionResponseError } from "../errors";
import type { TelegramAdapterOptions } from "../types";

export async function respondToAction<TChatId extends string>(args: {
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterRespondToActionInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<void, TelegramActionResponseError>> {
  const request = Result.try({
    try: () => encodeTelegramActionResponse(args.input),
    catch: (cause) =>
      TelegramActionResponseError.is(cause) ? cause : new TelegramActionResponseError({ cause }),
  });
  if (request.isErr()) {
    return Result.err(request.error);
  }

  const responded = await Result.tryPromise({
    try: async () => {
      if (request.value.kind === "ack") {
        await args.bot.answerCallbackQuery({
          callbackQueryId: request.value.callbackQueryId,
          options: request.value.options,
          signal: request.value.signal,
        });
        return;
      }

      if (request.value.kind === "reply") {
        await args.bot.sendMessage({
          chatId: request.value.chatId,
          text: request.value.text,
          options: request.value.options,
          signal: request.value.signal,
        });
        return;
      }

      await args.bot.editMessageText({
        chatId: request.value.chatId,
        messageId: request.value.messageId,
        text: request.value.text,
        options: request.value.options,
        signal: request.value.signal,
      });
    },
    catch: (cause) => new TelegramActionResponseError({ cause }),
  });

  return responded.isErr() ? Result.err(responded.error) : Result.ok();
}
