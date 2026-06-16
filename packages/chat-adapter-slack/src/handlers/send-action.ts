import { Result } from "better-result";
import type { ChatAdapterSendActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import { encodeSlackSendAction } from "../conversions/actions";
import { encodeSlackSentMessage } from "../conversions/outbound";
import { SlackSendActionError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function sendAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "actionStore">;
  readonly input: ChatAdapterSendActionInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      encodeSlackSendAction(args.input, { actionStore: args.config.actionStore }),
    );

    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: async () => args.client.postMessage({ ...request, signal: args.input.signal }),
        catch: (cause) => new SlackSendActionError({ cause }),
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
