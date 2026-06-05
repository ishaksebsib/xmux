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
  return Result.gen(async function* () {
    const request = yield* Result.try({
      try: () => encodeTelegramActionResponse(args.input),
      catch: (cause) =>
        TelegramActionResponseError.is(cause) ? cause : new TelegramActionResponseError({ cause }),
    });

    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          if (request.kind === "ack") {
            await args.bot.answerCallbackQuery({
              callbackQueryId: request.callbackQueryId,
              options: request.options,
              signal: request.signal,
            });
            return;
          }

          if (request.kind === "reply") {
            await args.bot.sendMessage({
              chatId: request.chatId,
              text: request.text,
              options: request.options,
              signal: request.signal,
            });
            return;
          }

          await args.bot.editMessageText({
            chatId: request.chatId,
            messageId: request.messageId,
            text: request.text,
            options: request.options,
            signal: request.signal,
          });
        },
        catch: (cause) => new TelegramActionResponseError({ cause }),
      }),
    );

    return Result.ok();
  });
}
