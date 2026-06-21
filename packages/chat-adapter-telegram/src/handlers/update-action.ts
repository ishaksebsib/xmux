import { Result } from "better-result";
import type { ChatAdapterUpdateActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramActionUpdate } from "../conversions/actions";

import { TelegramUpdateActionError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export async function updateAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterUpdateActionInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramUpdateActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.try({
      try: () =>
        encodeTelegramActionUpdate({
          chatId: args.input.chatId,
          conversationId: args.input.conversationId,
          message: args.input.message,
          text: args.input.text,
          format: args.input.format,
          buttons: args.input.buttons,
          adapterOptions: args.input.adapterOptions,
          signal: args.input.signal,
        }),
      catch: (cause) =>
        TelegramUpdateActionError.is(cause) ? cause : new TelegramUpdateActionError({ cause }),
    });

    yield* Result.await(
      Result.tryPromise({
        try: () =>
          args.bot.editMessageText({
            chatId: request.chatId,
            messageId: request.messageId,
            text: request.text,
            options: request.options,
            signal: request.signal,
          }),
        catch: (cause) => new TelegramUpdateActionError({ cause }),
      }),
    );

    return Result.ok({
      chatId: args.chatId,
      conversationId: args.input.conversationId,
      messageId: args.input.message.messageId,
      text: args.input.text,
      format: args.input.format,
      adapterData: {
        telegramChatId: args.input.conversationId,
        raw: { updated: true },
      },
    });
  });
}
