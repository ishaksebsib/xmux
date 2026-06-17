import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import {
  encodeSlackStreamedMessage,
  streamSlackNativeText,
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
  const adapterThreadTs = input.adapterOptions.stream?.threadTs?.trim();
  const messageThreadTs = input.message?.messageId.trim();
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

  return validateSlackStreamRecipientTarget({
    conversationId: input.conversationId,
    threadTs,
    stream: input.adapterOptions.stream,
    createError: (reason) => new SlackStreamReplyError({ reason }),
  });
}

function validateSlackStreamRecipientTarget<TError>(args: {
  readonly conversationId: string;
  readonly threadTs: string;
  readonly stream: SlackAdapterOptions["stream"];
  readonly createError: (reason: string) => TError;
}): Result<SlackNativeStreamTarget, TError> {
  const recipientTeamId = args.stream?.recipientTeamId?.trim();
  const recipientUserId = args.stream?.recipientUserId?.trim();
  const isDm = args.conversationId.startsWith("D");

  if (!isDm && (recipientTeamId === undefined || recipientUserId === undefined)) {
    return Result.err(
      args.createError(
        "Slack native streaming to channels requires adapterOptions.stream.recipientTeamId and recipientUserId",
      ),
    );
  }

  return Result.ok({
    channel: args.conversationId,
    threadTs: args.threadTs,
    recipientTeamId,
    recipientUserId,
    taskDisplayMode: args.stream?.taskDisplayMode,
  });
}
