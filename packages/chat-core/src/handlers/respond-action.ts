import { Result } from "better-result";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import { ChatActionResponseError, type ChatActionResponseFailure } from "../errors";
import {
  chatLogEvents,
  logChatResult,
  startChatLogTimer,
  type ChatLogEventName,
  type ChatLogScope,
} from "../logger";
import type { GetStartedRuntime } from "./types";
import { createAdapterRespondToActionInput, type RespondToActionInput } from "./adapter-inputs";

export function createRespondToActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}) {
  return async function respondToAction<
    TInput extends RespondToActionInput<Extract<keyof TAdapters, string>>,
  >(input: TInput): Promise<Result<void, ChatActionResponseFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "respondToAction",
      conversationId: input.conversationId,
      messageId: input.message.messageId,
      interactionId: input.interactionId,
      responseKind: input.response.kind,
    } as const;

    args.logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = await Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({
          chatId: input.chatId,
          operation: "respondToAction",
        }),
      );
      const adapterInput = createAdapterRespondToActionInput<TAdapters, TInput>(input);

      const response = yield* Result.await(
        Result.tryPromise({
          try: async () => runtime.respondToAction(adapterInput),
          catch: (cause) => new ChatActionResponseError({ chatId: input.chatId, cause }),
        }),
      );

      return Result.map(
        Result.mapError(
          response,
          (cause) => new ChatActionResponseError({ chatId: input.chatId, cause }),
        ),
        () => undefined,
      );
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
