import { Result } from "better-result";
import { ChatSendMessageError, type ChatSendMessageFailure } from "../errors";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSendMessageInput, ChatSentMessageFromInput } from "../inputs";
import {
  chatLogEvents,
  logChatResult,
  startChatLogTimer,
  type ChatLogEventName,
  type ChatLogScope,
} from "../logger";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendMessageInput } from "./adapter-inputs";

export function createSendMessageHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}) {
  return async function sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "sendMessage",
      conversationId: input.conversationId,
      textLength: input.text.length,
      format: input.format,
    } as const;

    args.logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = await Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "sendMessage" }),
      );
      const adapterInput = createAdapterSendMessageInput<TAdapters, TInput>(input);

      const sent = yield* Result.await(
        Result.tryPromise({
          try: async () => runtime.sendMessage(adapterInput),
          catch: (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
        }),
      );

      return Result.mapError(
        sent,
        (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
      ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>;
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
