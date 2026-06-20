import { Result } from "better-result";
import type { ChatAdapterReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import { parseSlackConversationId } from "../conversation";
import { encodeSlackReplyMessage, encodeSlackSentMessage } from "../conversions/outbound";
import { nonEmptySlackStreamValue } from "../conversions/streaming";
import { SlackReplyError } from "../errors";
import type { SlackStreamSourceRegistry } from "../stores/stream-source-registry";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function reply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly input: ChatAdapterReplyInput<TChatId, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackReplyError>> {
  return Result.gen(async function* () {
    const request = yield* encodeSlackReplyMessage(args.input);
    const threadTs = resolveSlackReplySourceThreadTs({
      input: args.input,
      streamSourceRegistry: args.streamSourceRegistry,
    });

    const slackMessage = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          args.client.postMessage({
            ...request,
            ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
            signal: args.input.signal,
          }),
        catch: (cause) => new SlackReplyError({ cause }),
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

function resolveSlackReplySourceThreadTs(args: {
  readonly input: ChatAdapterReplyInput<string, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): string | undefined {
  const mode = args.input.mode ?? "auto";
  if (mode === "conversation") return undefined;

  const messageTs = nonEmptySlackStreamValue(args.input.message?.messageId);
  if (messageTs === undefined) return undefined;

  const target = parseSlackConversationId(args.input.conversationId);
  const source = args.streamSourceRegistry.get({
    channelId: target.channelId,
    messageTs,
  });

  return nonEmptySlackStreamValue(source?.threadTs);
}
