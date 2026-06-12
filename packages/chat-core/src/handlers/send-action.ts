import { Result } from "better-result";
import { ChatSendActionError, type ChatSendActionFailure } from "../errors";
import type { ChatActionRegistry } from "../registry/actions";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSendActionInput, ChatSentMessageFromInput } from "../inputs";
import { chatLogEvents, type ChatLogEventName, type ChatLogScope } from "../logger";
import { logChatResult, startChatLogTimer } from "../logger-utils";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendActionInput } from "./adapter-inputs";

export function createSendActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}) {
  return async function sendAction<TInput extends ChatSendActionInput<TAdapters, TActions>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "sendAction",
      conversationId: input.conversationId,
      textLength: input.text.length,
      format: input.format,
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;

    args.logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = await Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "sendAction" }),
      );
      const adapterInput = createAdapterSendActionInput<TAdapters, TActions, TInput>(input);

      const sent = yield* Result.await(
        Result.tryPromise({
          try: async () => runtime.sendAction(adapterInput),
          catch: (cause) => new ChatSendActionError({ chatId: input.chatId, cause }),
        }),
      );

      return Result.mapError(
        sent,
        (cause) => new ChatSendActionError({ chatId: input.chatId, cause }),
      ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>;
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
