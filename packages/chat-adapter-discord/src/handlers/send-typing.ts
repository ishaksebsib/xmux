import { Result } from "better-result";
import type { ChatAdapterSendTypingInput } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import { encodeDiscordSendTyping } from "../conversions/outbound";
import { DiscordSendTypingError } from "../errors";
import type { DiscordAdapterOptions } from "../types";

export async function sendTyping<TChatId extends string>(args: {
  readonly client: DiscordBotClient;
  readonly input: ChatAdapterSendTypingInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<void, DiscordSendTypingError>> {
  return Result.tryPromise({
    try: async () => {
      const request = encodeDiscordSendTyping(args.input);
      await args.client.sendTyping({ ...request, signal: args.input.signal });
    },
    catch: (cause) => new DiscordSendTypingError({ cause }),
  });
}
