import { Result } from "better-result";
import type { TelegramBotClient, TelegramStreamedTextMessages } from "../client";
import { encodeTelegramMarkdownText } from "../conversions/formatting";

export async function finalizeMarkdownStream<TError>(args: {
  readonly bot: TelegramBotClient;
  readonly telegramMessages: TelegramStreamedTextMessages;
  readonly signal?: AbortSignal;
  readonly createError: (cause: unknown) => TError;
}): Promise<Result<void, TError>> {
  const finalized = await Result.tryPromise({
    try: async () => {
      for (const message of args.telegramMessages) {
        const text = encodeTelegramMarkdownText(message.text);
        if (text === message.text) {
          continue;
        }

        await args.bot.editMessageText({
          chatId: message.chat.id,
          messageId: message.message_id,
          text,
          options: { parse_mode: "MarkdownV2" },
          signal: args.signal,
        });
      }
    },
    catch: args.createError,
  });

  return finalized.isErr() ? Result.err(finalized.error) : Result.ok();
}
