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
import type {
  SlackStreamSourceContext,
  SlackStreamSourceRegistry,
} from "../stores/stream-source-registry";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function streamReply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly input: ChatAdapterStreamReplyInput<TChatId, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamReplyError>> {
  return Result.gen(async function* () {
    const target = yield* resolveSlackStreamReplyTarget({
      input: args.input,
      streamSourceRegistry: args.streamSourceRegistry,
    });
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

function resolveSlackStreamReplyTarget(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Result<SlackNativeStreamTarget, SlackStreamReplyError> {
  const input = args.input;
  const mode = input.mode ?? "auto";
  const stream = input.adapterOptions.stream;
  const sourceContext = resolveSlackStreamReplySourceContext({
    input,
    streamSourceRegistry: args.streamSourceRegistry,
  });
  const adapterThreadTs = nonEmptySlackStreamValue(stream?.threadTs);
  const messageThreadTs = nonEmptySlackStreamValue(input.message?.messageId);
  const sourceThreadTs = nonEmptySlackStreamValue(sourceContext?.threadTs);
  const threadTs =
    mode === "conversation"
      ? adapterThreadTs
      : (sourceThreadTs ?? messageThreadTs ?? adapterThreadTs);

  if (threadTs === undefined || threadTs.length === 0) {
    return Result.err(
      new SlackStreamReplyError({
        reason:
          mode === "conversation"
            ? "Slack native stream replies in conversation mode require a native stream thread target"
            : "Slack native stream replies require a source message because chat.startStream must reply to a user request",
      }),
    );
  }

  return validateSlackNativeStreamTarget({
    conversationId: input.conversationId,
    threadTs,
    recipientTeamId:
      nonEmptySlackStreamValue(stream?.recipientTeamId) ?? sourceContext?.recipientTeamId,
    recipientUserId:
      nonEmptySlackStreamValue(stream?.recipientUserId) ?? sourceContext?.recipientUserId,
    taskDisplayMode: stream?.taskDisplayMode,
    createError: (reason) => new SlackStreamReplyError({ reason }),
  });
}

function resolveSlackStreamReplySourceContext(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): SlackStreamSourceContext | undefined {
  const messageTs = nonEmptySlackStreamValue(args.input.message?.messageId);
  if (messageTs === undefined) return undefined;

  return args.streamSourceRegistry.get({
    channelId: args.input.conversationId,
    messageTs,
  });
}
