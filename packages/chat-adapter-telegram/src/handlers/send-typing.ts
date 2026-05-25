import { Result } from "better-result";
import type { ChatAdapterSendTypingInput } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import { encodeTelegramSendTyping } from "../conversions/outbound";
import { TelegramSendTypingError } from "../errors";
import type { TelegramAdapterOptions } from "../types";

export async function sendTyping<TChatId extends string>(args: {
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterSendTypingInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<void, TelegramSendTypingError>> {
  const request = encodeTelegramSendTyping(args.input);
  const sent = await Result.tryPromise({
    try: async () => args.bot.sendChatAction({ ...request, signal: args.input.signal }),
    catch: (cause) => new TelegramSendTypingError({ cause }),
  });

  return sent.isErr() ? Result.err(sent.error) : Result.ok();
}
