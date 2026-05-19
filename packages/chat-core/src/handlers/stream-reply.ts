import { Result } from "better-result";
import {
  ChatStreamReplyError,
  UnsupportedChatOperationError,
  type ChatStreamReplyFailure,
} from "../errors";
import type {
  ChatAdapterDefinitions,
  ChatSentMessageFromInput,
  ChatStreamReplyInput,
} from "../types";
import type {
  GetStartedRuntime,
  ReplyHandler,
  ReplyInputForStream,
  StreamFallbackDiagnosticEmit,
} from "./types";
import {
  collectChatTextStream,
  createAdapterStreamReplyInput,
  emitStreamFallbackDiagnostic,
  hasStreamReplyRuntime,
  sentMessageFromSameChatInput,
} from "./utils";

export function createStreamReplyHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly emit: StreamFallbackDiagnosticEmit<Extract<keyof TAdapters, string>>;
  readonly reply: ReplyHandler<TAdapters>;
}) {
  return async function streamReply<TInput extends ChatStreamReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamReplyFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "streamReply" }),
      );
      const fallback = input.fallback ?? "send-message";

      if (hasStreamReplyRuntime(runtime)) {
        const streamResult = yield* Result.await(
          Result.tryPromise({
            try: async () =>
              runtime.streamReply(createAdapterStreamReplyInput<TAdapters, TInput>(input)),
            catch: (cause) => new ChatStreamReplyError({ chatId: input.chatId, cause }),
          }),
        );

        if (streamResult.isErr()) {
          return Result.err(
            new ChatStreamReplyError({ chatId: input.chatId, cause: streamResult.error }),
          );
        }

        return Result.ok(streamResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
      }

      if (fallback === "error") {
        return Result.err(
          new UnsupportedChatOperationError({ chatId: input.chatId, operation: "streamReply" }),
        );
      }

      emitStreamFallbackDiagnostic({
        chatId: input.chatId,
        operation: "streamReply",
        emit: args.emit,
      });
      const collected = yield* Result.await(collectStreamForReply<TAdapters, TInput>({ input }));
      const replied = yield* Result.await(args.reply(collected));
      return Result.ok(sentMessageFromSameChatInput<TAdapters, TInput>(replied));
    });
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
  if (collected.isErr()) {
    return Result.err(collected.error);
  }

  return Result.ok({
    chatId: args.input.chatId,
    conversationId: args.input.conversationId,
    messageId: args.input.messageId,
    text: collected.value,
    format: args.input.content.format,
    mode: args.input.mode,
    adapterOptions: "adapterOptions" in args.input ? args.input.adapterOptions : {},
    signal: args.input.signal,
  } as ReplyInputForStream<TAdapters, TInput>);
}
