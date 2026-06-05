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
  return Result.tryPromise({
    try: async () => {
      const request = encodeTelegramSendTyping(args.input);
      await args.bot.sendChatAction({ ...request, signal: args.input.signal });
    },
    catch: (cause) => new TelegramSendTypingError({ cause }),
  });
}
