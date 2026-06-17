import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import {
  encodeSlackStreamedMessage,
  nonEmptySlackStreamValue,
  streamSlackNativeText,
  validateSlackNativeStreamTarget,
  type SlackNativeStreamTarget,
} from "../conversions/streaming";
import { SlackStreamReplyError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function streamReply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly input: ChatAdapterStreamReplyInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamReplyError>> {
  return Result.gen(async function* () {
    const target = yield* resolveSlackStreamReplyTarget(args.input);
    const streamed = yield* Result.await(
      streamSlackNativeText({
        client: args.client,
        target,
        chunks: args.input.content.chunks,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
        config: args.config,
        signal: args.input.signal,
        createError: ({ reason, cause }) => new SlackStreamReplyError({ reason, cause }),
      }),
    );

    const sent = yield* Result.try({
      try: () =>
        encodeSlackStreamedMessage({
          chatId: args.chatId,
          conversationId: args.input.conversationId,
          text: streamed.text,
          format: args.input.content.format,
          threadTs: target.threadTs,
          slackMessages: streamed.slackMessages,
        }),
      catch: (cause) => new SlackStreamReplyError({ cause }),
    });

    return Result.ok(sent);
  });
}

function resolveSlackStreamReplyTarget(
  input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>,
): Result<SlackNativeStreamTarget, SlackStreamReplyError> {
  const mode = input.mode ?? "auto";
  const adapterThreadTs = nonEmptySlackStreamValue(input.adapterOptions.stream?.threadTs);
  const messageThreadTs = nonEmptySlackStreamValue(input.message?.messageId);
  const threadTs = mode === "conversation" ? adapterThreadTs : (messageThreadTs ?? adapterThreadTs);

  if (threadTs === undefined || threadTs.length === 0) {
    return Result.err(
      new SlackStreamReplyError({
        reason:
          mode === "conversation"
            ? "Slack native stream replies in conversation mode require adapterOptions.stream.threadTs"
            : "Slack native stream replies require a message id or adapterOptions.stream.threadTs because chat.startStream must reply to a user request",
      }),
    );
  }

  return validateSlackNativeStreamTarget({
    conversationId: input.conversationId,
    threadTs,
    stream: input.adapterOptions.stream,
    createError: (reason) => new SlackStreamReplyError({ reason }),
  });
}
