import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import { parseSlackConversationId, type SlackConversationTarget } from "../conversation";
import {
  encodeSlackStreamedMessage,
  nonEmptySlackStreamValue,
  streamSlackMessageUpdates,
  streamSlackNativeText,
  validateSlackNativeStreamTarget,
  type SlackMessageUpdateStreamTarget,
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
    const conversationTarget = parseSlackConversationId(args.input.conversationId);
    const nativeTarget = resolveSlackStreamReplyTarget({
      input: args.input,
      conversationTarget,
      streamSourceRegistry: args.streamSourceRegistry,
    });
    const target = nativeTarget.isOk()
      ? { type: "native" as const, target: nativeTarget.value }
      : {
          type: "update" as const,
          target: yield* resolveSlackStreamReplyUpdateTarget({
            input: args.input,
            conversationTarget,
            streamSourceRegistry: args.streamSourceRegistry,
          }),
        };
    const streamed = yield* Result.await(
      target.type === "native"
        ? streamSlackNativeText({
            client: args.client,
            target: target.target,
            chunks: args.input.content.chunks,
            format: args.input.content.format,
            adapterOptions: args.input.adapterOptions,
            config: args.config,
            signal: args.input.signal,
            createError: ({ reason, cause }) => new SlackStreamReplyError({ reason, cause }),
          })
        : streamSlackMessageUpdates({
            client: args.client,
            target: target.target,
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
          ...(target.target.threadTs === undefined ? {} : { threadTs: target.target.threadTs }),
          slackMessages: streamed.slackMessages,
        }),
      catch: (cause) => new SlackStreamReplyError({ cause }),
    });

    return Result.ok(sent);
  });
}

function resolveSlackStreamReplyUpdateTarget(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Result<SlackMessageUpdateStreamTarget, SlackStreamReplyError> {
  const input = args.input;
  const mode = input.mode ?? "auto";
  const threadTs = resolveSlackStreamReplyThreadTs(args);

  if ((mode === "thread" || mode === "quote") && threadTs === undefined) {
    return Result.err(
      new SlackStreamReplyError({ reason: "Slack thread stream replies require a source message" }),
    );
  }

  return Result.ok({
    channel: args.conversationTarget.channelId,
    ...(threadTs === undefined ? {} : { threadTs }),
    ...(mode === "conversation" ||
    threadTs === undefined ||
    input.adapterOptions.replyBroadcast === undefined
      ? {}
      : { replyBroadcast: input.adapterOptions.replyBroadcast }),
  });
}

function resolveSlackStreamReplyTarget(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): Result<SlackNativeStreamTarget, SlackStreamReplyError> {
  const input = args.input;
  const mode = input.mode ?? "auto";
  const stream = input.adapterOptions.stream;
  const sourceContext = resolveSlackStreamReplySourceContext({
    input,
    conversationTarget: args.conversationTarget,
    streamSourceRegistry: args.streamSourceRegistry,
  });
  const adapterThreadTs = nonEmptySlackStreamValue(stream?.threadTs);
  const messageThreadTs = nonEmptySlackStreamValue(input.message?.messageId);
  const sourceThreadTs = nonEmptySlackStreamValue(sourceContext?.threadTs);
  const conversationThreadTs = args.conversationTarget.threadTs;
  const threadTs =
    mode === "conversation"
      ? (adapterThreadTs ?? conversationThreadTs)
      : (sourceThreadTs ?? conversationThreadTs ?? messageThreadTs ?? adapterThreadTs);

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
    conversationId: args.conversationTarget.channelId,
    threadTs,
    recipientTeamId:
      nonEmptySlackStreamValue(stream?.recipientTeamId) ?? sourceContext?.recipientTeamId,
    recipientUserId:
      nonEmptySlackStreamValue(stream?.recipientUserId) ?? sourceContext?.recipientUserId,
    taskDisplayMode: stream?.taskDisplayMode,
    createError: (reason) => new SlackStreamReplyError({ reason }),
  });
}

function resolveSlackStreamReplyThreadTs(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): string | undefined {
  const sourceContext = resolveSlackStreamReplySourceContext(args);

  const mode = args.input.mode ?? "auto";
  const adapterThreadTs = nonEmptySlackStreamValue(args.input.adapterOptions.stream?.threadTs);

  if (mode === "conversation") {
    return adapterThreadTs ?? args.conversationTarget.threadTs;
  }

  return (
    nonEmptySlackStreamValue(sourceContext?.threadTs) ??
    args.conversationTarget.threadTs ??
    nonEmptySlackStreamValue(args.input.message?.messageId) ??
    adapterThreadTs
  );
}

function resolveSlackStreamReplySourceContext(args: {
  readonly input: ChatAdapterStreamReplyInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
  readonly streamSourceRegistry: SlackStreamSourceRegistry;
}): SlackStreamSourceContext | undefined {
  const messageTs = nonEmptySlackStreamValue(args.input.message?.messageId);
  if (messageTs === undefined) return undefined;

  return args.streamSourceRegistry.get({
    channelId: args.conversationTarget.channelId,
    messageTs,
  });
}
