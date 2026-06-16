import { Result } from "better-result";
import type { ChatAdapterSendMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import { encodeSlackSendMessage, encodeSlackSentMessage } from "../conversions/outbound";
import { SlackSendMessageError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function sendMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly input: ChatAdapterSendMessageInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendMessageError>> {
  return Result.gen(async function* () {
    const request = yield* encodeSlackSendMessage(args.input);
    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.client.postMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new SlackSendMessageError({ cause }),
      }),
    );

    return Result.ok(
      encodeSlackSentMessage({
        chatId: args.chatId,
        text: args.input.text,
        format: args.input.format,
        slackMessage,
      }),
    );
  });
}
