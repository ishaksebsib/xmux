import { Result } from "better-result";
import type { ChatAdapterSendActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import { encodeSlackSendAction } from "../conversions/actions";
import { encodeSlackSentMessage } from "../conversions/outbound";
import { nonEmptySlackStreamValue } from "../conversions/streaming";
import { SlackSendActionError } from "../errors";
import type { SlackStreamSourceRegistry } from "../stores/stream-source-registry";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function sendAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "actionStore">;
  readonly input: ChatAdapterSendActionInput<TChatId, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackSendActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      encodeSlackSendAction(args.input, { actionStore: args.config.actionStore }),
    );

    const threadTs = resolveSlackSendActionThreadTs({
      input: args.input,
      streamSourceRegistry: args.streamSourceRegistry,
    });

    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          args.client.postMessage({
            ...request,
            ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
            ...(threadTs === undefined || args.input.adapterOptions.replyBroadcast === undefined
              ? {}
              : { reply_broadcast: args.input.adapterOptions.replyBroadcast }),
            signal: args.input.signal,
          }),
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

function resolveSlackSendActionThreadTs(args: {
  readonly input: ChatAdapterSendActionInput<string, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): string | undefined {
  const messageTs = nonEmptySlackStreamValue(args.input.message?.messageId);
  if (messageTs === undefined) return undefined;

  const source = args.streamSourceRegistry.get({
    channelId: args.input.conversationId,
    messageTs,
  });

  return nonEmptySlackStreamValue(source?.threadTs) ?? messageTs;
}
