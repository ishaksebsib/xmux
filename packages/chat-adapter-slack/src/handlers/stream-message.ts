import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import {
  encodeSlackStreamedMessage,
  nonEmptySlackStreamValue,
  streamSlackNativeText,
  validateSlackNativeStreamTarget,
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
  const threadTs = nonEmptySlackStreamValue(input.adapterOptions.stream?.threadTs);
  if (threadTs === undefined || threadTs.length === 0) {
    return Result.err(
      new SlackStreamMessageError({
        reason:
          "Slack native streamMessage requires adapterOptions.stream.threadTs because chat.startStream must reply to a user request",
      }),
    );
  }

  return validateSlackNativeStreamTarget({
    conversationId: input.conversationId,
    threadTs,
    stream: input.adapterOptions.stream,
    createError: (reason) => new SlackStreamMessageError({ reason }),
  });
}
