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
  const request = encodeTelegramReplyMessage(args.input);
  if (request.isErr()) {
    return Result.err(request.error);
  }

  const sent = await Result.tryPromise({
    try: async () => args.bot.sendMessage({ ...request.value, signal: args.input.signal }),
    catch: (cause) => new TelegramReplyError({ cause }),
  });
  if (sent.isErr()) {
    return Result.err(sent.error);
  }

  return Result.ok(
    encodeTelegramSentMessage({
      chatId: args.chatId,
      conversationId: args.input.conversationId,
      text: args.input.text,
      format: args.input.format,
      telegramMessage: sent.value,
    }),
  );
}
