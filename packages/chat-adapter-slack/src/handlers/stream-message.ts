import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import {
  encodeSlackStreamedMessage,
  streamSlackNativeText,
  type SlackNativeStreamTarget,
} from "../conversions/streaming";
import { SlackStreamMessageError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function streamMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly input: ChatAdapterStreamMessageInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamMessageError>> {
  return Result.gen(async function* () {
    const target = yield* resolveSlackStreamMessageTarget(args.input);
    const streamed = yield* Result.await(
      streamSlackNativeText({
        client: args.client,
        target,
        chunks: args.input.content.chunks,
        format: args.input.content.format,
        adapterOptions: args.input.adapterOptions,
        config: args.config,
        signal: args.input.signal,
        createError: ({ reason, cause }) => new SlackStreamMessageError({ reason, cause }),
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
      catch: (cause) => new SlackStreamMessageError({ cause }),
    });

    return Result.ok(sent);
  });
}

function resolveSlackStreamMessageTarget(
  input: ChatAdapterStreamMessageInput<string, SlackAdapterOptions>,
): Result<SlackNativeStreamTarget, SlackStreamMessageError> {
  const threadTs = input.adapterOptions.stream?.threadTs?.trim();
  if (threadTs === undefined || threadTs.length === 0) {
    return Result.err(
      new SlackStreamMessageError({
        reason:
          "Slack native streamMessage requires adapterOptions.stream.threadTs because chat.startStream must reply to a user request",
      }),
    );
  }

  return validateSlackStreamRecipientTarget({
    conversationId: input.conversationId,
    threadTs,
    stream: input.adapterOptions.stream,
    createError: (reason) => new SlackStreamMessageError({ reason }),
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
