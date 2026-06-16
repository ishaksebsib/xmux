import { Result } from "better-result";
import type { ChatAdapterReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import { encodeSlackReplyMessage, encodeSlackSentMessage } from "../conversions/outbound";
import { SlackReplyError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function reply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly input: ChatAdapterReplyInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackReplyError>> {
  return Result.gen(async function* () {
    const request = yield* encodeSlackReplyMessage(args.input);
    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.client.postMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new SlackReplyError({ cause }),
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
