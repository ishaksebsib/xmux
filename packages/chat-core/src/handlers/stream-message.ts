import { Result } from "better-result";
import {
  ChatStreamMessageError,
  UnsupportedChatOperationError,
  type ChatStreamMessageFailure,
} from "../errors";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSentMessageFromInput, ChatStreamMessageInput } from "../inputs";
import type {
  GetStartedRuntime,
  SendMessageHandler,
  SendMessageInputForStream,
  StreamFallbackDiagnosticEmit,
} from "./types";
import {
  createAdapterStreamMessageInput,
  sentMessageFromSameChatInput,
} from "./adapter-inputs";
import {
  collectChatTextStream,
  emitStreamFallbackDiagnostic,
  hasStreamMessageRuntime,
} from "./stream";

export function createStreamMessageHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly emit: StreamFallbackDiagnosticEmit<Extract<keyof TAdapters, string>>;
  readonly sendMessage: SendMessageHandler<TAdapters>;
}) {
  return async function streamMessage<TInput extends ChatStreamMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamMessageFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "streamMessage" }),
      );
      const fallback = input.fallback ?? "send-message";

      if (hasStreamMessageRuntime(runtime)) {
        const streamResult = yield* Result.await(
          Result.tryPromise({
            try: async () =>
              runtime.streamMessage(createAdapterStreamMessageInput<TAdapters, TInput>(input)),
            catch: (cause) => new ChatStreamMessageError({ chatId: input.chatId, cause }),
          }),
        );

        return Result.mapError(
          streamResult,
          (cause) => new ChatStreamMessageError({ chatId: input.chatId, cause }),
        ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatStreamMessageFailure>;
      }

      if (fallback === "error") {
        return Result.err(
          new UnsupportedChatOperationError({ chatId: input.chatId, operation: "streamMessage" }),
        );
      }

      emitStreamFallbackDiagnostic({
        chatId: input.chatId,
        operation: "streamMessage",
        emit: args.emit,
      });
      const collected = yield* Result.await(collectStreamForMessage<TAdapters, TInput>({ input }));
      const sent = yield* Result.await(args.sendMessage(collected));
      return Result.ok(sentMessageFromSameChatInput<TAdapters, TInput>(sent));
    });
  };
}

async function collectStreamForMessage<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamMessageInput<TAdapters>,
>(args: {
  readonly input: TInput;
}): Promise<Result<SendMessageInputForStream<TAdapters, TInput>, ChatStreamMessageError>> {
  const collected = await Result.tryPromise({
    try: async () => collectChatTextStream(args.input.content.chunks),
    catch: (cause) => new ChatStreamMessageError({ chatId: args.input.chatId, cause }),
  });

  return Result.map(
    collected,
    (text) =>
      ({
        chatId: args.input.chatId,
        conversationId: args.input.conversationId,
        text,
        format: args.input.content.format,
        adapterOptions: "adapterOptions" in args.input ? args.input.adapterOptions : {},
        signal: args.input.signal,
      }) as SendMessageInputForStream<TAdapters, TInput>,
  );
}
