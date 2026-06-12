import { Result } from "better-result";
import {
  ChatStreamReplyError,
  UnsupportedChatOperationError,
  type ChatStreamReplyFailure,
} from "../errors";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSentMessageFromInput, ChatStreamReplyInput } from "../inputs";
import {
  chatLogEvents,
  logChatResult,
  startChatLogTimer,
  type ChatLogEventName,
  type ChatLogScope,
} from "../logger";
import type { GetStartedRuntime, ReplyHandler, ReplyInputForStream } from "./types";
import { createAdapterStreamReplyInput, sentMessageFromSameChatInput } from "./adapter-inputs";
import { collectChatTextStream, hasStreamReplyRuntime } from "./stream";

export function createStreamReplyHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly reply: ReplyHandler<TAdapters>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}) {
  return async function streamReply<TInput extends ChatStreamReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>> {
    const mode = input.mode ?? "auto";
    const fallback = input.fallback ?? "send-message";
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "streamReply",
      conversationId: input.conversationId,
      messageId: input.messageId,
      mode,
      format: input.content.format,
      fallback,
    } as const;

    args.logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = await Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "streamReply" }),
      );

      if (hasStreamReplyRuntime(runtime)) {
        const streamResult = yield* Result.await(
          Result.tryPromise({
            try: async () =>
              runtime.streamReply(createAdapterStreamReplyInput<TAdapters, TInput>(input)),
            catch: (cause) => new ChatStreamReplyError({ chatId: input.chatId, cause }),
          }),
        );

        return Result.mapError(
          streamResult,
          (cause) => new ChatStreamReplyError({ chatId: input.chatId, cause }),
        ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>;
      }

      if (fallback === "error") {
        return Result.err(
          new UnsupportedChatOperationError({ chatId: input.chatId, operation: "streamReply" }),
        );
      }

      args.logger?.debug(chatLogEvents.operationFallback, {
        chatId: String(input.chatId),
        operation: "streamReply",
        conversationId: input.conversationId,
        messageId: input.messageId,
        mode,
        fallback,
      });

      const collected = yield* Result.await(collectStreamForReply<TAdapters, TInput>({ input }));
      const replied = yield* Result.await(args.reply(collected));
      return Result.ok(sentMessageFromSameChatInput<TAdapters, TInput>(replied));
    });

    logChatResult({
      logger: args.logger,
      result,
      startedAt,
      metadata,
      successEvent: chatLogEvents.operationSuccess,
      failureEvent: chatLogEvents.operationFailure,
    });

    return result;
  };
}

async function collectStreamForReply<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamReplyInput<TAdapters>,
>(args: {
  readonly input: TInput;
}): Promise<Result<ReplyInputForStream<TAdapters, TInput>, ChatStreamReplyError>> {
  const collected = await Result.tryPromise({
    try: async () => collectChatTextStream(args.input.content.chunks),
    catch: (cause) => new ChatStreamReplyError({ chatId: args.input.chatId, cause }),
  });

  return Result.map(
    collected,
    (text) =>
      ({
        chatId: args.input.chatId,
        conversationId: args.input.conversationId,
        messageId: args.input.messageId,
        text,
        format: args.input.content.format,
        mode: args.input.mode,
        adapterOptions: "adapterOptions" in args.input ? args.input.adapterOptions : {},
        signal: args.input.signal,
      }) as ReplyInputForStream<TAdapters, TInput>,
  );
}
