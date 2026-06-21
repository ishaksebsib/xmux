import { Result } from "better-result";
import type { ChatAdapterUpdateActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import { encodeSlackActionUpdate } from "../conversions/actions";
import { encodeSlackSentMessage } from "../conversions/outbound";
import { SlackUpdateActionError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function updateAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "actionStore">;
  readonly input: ChatAdapterUpdateActionInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackUpdateActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      encodeSlackActionUpdate(args.input, { actionStore: args.config.actionStore }),
    );

    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: () => args.client.updateMessage(request.update),
        catch: (cause) => new SlackUpdateActionError({ cause }),
      }),
    );

    return Result.ok(
      encodeSlackSentMessage({
        chatId: args.chatId,
        conversationId: args.input.conversationId,
        text: args.input.text,
        format: args.input.format,
        slackMessage,
      }),
    );
  });
}
