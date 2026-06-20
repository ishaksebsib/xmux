import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
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
import { SlackStreamMessageError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";

export async function streamMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly input: ChatAdapterStreamMessageInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, SlackAdapterData>, SlackStreamMessageError>> {
  return Result.gen(async function* () {
    const conversationTarget = parseSlackConversationId(args.input.conversationId);
    const nativeTarget = resolveSlackStreamMessageTarget({
      input: args.input,
      conversationTarget,
    });
    const target = nativeTarget.isOk()
      ? { type: "native" as const, target: nativeTarget.value }
      : {
          type: "update" as const,
          target: resolveSlackStreamMessageUpdateTarget({ input: args.input, conversationTarget }),
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
            createError: ({ reason, cause }) => new SlackStreamMessageError({ reason, cause }),
          })
        : streamSlackMessageUpdates({
            client: args.client,
            target: target.target,
            chunks: args.input.content.chunks,
            format: args.input.content.format,
            adapterOptions: args.input.adapterOptions,
            config: args.config,
            signal: args.input.signal,
            createError: ({ reason, cause }) => new SlackStreamMessageError({ reason, cause }),
          }),
    );

    const threadTs = target.target.threadTs;
    const sent = yield* Result.try({
      try: () =>
        encodeSlackStreamedMessage({
          chatId: args.chatId,
          conversationId: args.input.conversationId,
          text: streamed.text,
          format: args.input.content.format,
          ...(threadTs === undefined ? {} : { threadTs }),
          slackMessages: streamed.slackMessages,
        }),
      catch: (cause) => new SlackStreamMessageError({ cause }),
    });

    return Result.ok(sent);
  });
}

function resolveSlackStreamMessageUpdateTarget(args: {
  readonly input: ChatAdapterStreamMessageInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
}): SlackMessageUpdateStreamTarget {
  const threadTs =
    nonEmptySlackStreamValue(args.input.adapterOptions.stream?.threadTs) ??
    args.conversationTarget.threadTs;

  return {
    channel: args.conversationTarget.channelId,
    ...(threadTs === undefined ? {} : { threadTs }),
  };
}

function resolveSlackStreamMessageTarget(args: {
  readonly input: ChatAdapterStreamMessageInput<string, SlackAdapterOptions>;
  readonly conversationTarget: SlackConversationTarget;
}): Result<SlackNativeStreamTarget, SlackStreamMessageError> {
  const threadTs =
    nonEmptySlackStreamValue(args.input.adapterOptions.stream?.threadTs) ??
    args.conversationTarget.threadTs;
  if (threadTs === undefined || threadTs.length === 0) {
    return Result.err(
      new SlackStreamMessageError({
        reason:
          "Slack native streamMessage requires a source thread timestamp because chat.startStream must reply to a user request",
      }),
    );
  }

  return validateSlackNativeStreamTarget({
    conversationId: args.conversationTarget.channelId,
    threadTs,
    recipientTeamId: args.input.adapterOptions.stream?.recipientTeamId,
    recipientUserId: args.input.adapterOptions.stream?.recipientUserId,
    taskDisplayMode: args.input.adapterOptions.stream?.taskDisplayMode,
    createError: (reason) => new SlackStreamMessageError({ reason }),
  });
}
