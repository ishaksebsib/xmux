import { Result } from "better-result";
import {
  ChatUpdateActionError,
  UnsupportedChatOperationError,
  type ChatUpdateActionFailure,
} from "../errors";
import type { ChatActionRegistry } from "../registry/actions";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSentMessageFromInput, ChatUpdateActionInput } from "../inputs";
import { chatLogEvents, type ChatLogEventName, type ChatLogScope } from "../logger";
import { logChatResult, startChatLogTimer } from "../logger-utils";
import type { GetStartedRuntime } from "./types";
import { createAdapterUpdateActionInput } from "./adapter-inputs";

export function createUpdateActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
  readonly logger?: ChatLogScope<ChatLogEventName>;
}) {
  return async function updateAction<TInput extends ChatUpdateActionInput<TAdapters, TActions>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatUpdateActionFailure>> {
    const startedAt = startChatLogTimer();
    const metadata = {
      chatId: String(input.chatId),
      operation: "updateAction",
      conversationId: input.conversationId,
      messageId: input.messageId,
      textLength: input.text.length,
      format: input.format,
      buttonRows: input.buttons.length,
      buttonCount: input.buttons.reduce((count, row) => count + row.length, 0),
    } as const;

    args.logger?.debug(chatLogEvents.operationBegin, metadata);

    const result = await Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "updateAction" }),
      );

      if (runtime.updateAction === undefined) {
        return Result.err(
          new UnsupportedChatOperationError({
            chatId: String(input.chatId),
            operation: "updateAction",
          }),
        );
      }

      const adapterInput = createAdapterUpdateActionInput<TAdapters, TActions, TInput>(input);
      const updateAction = runtime.updateAction.bind(runtime);
      const updated = yield* Result.await(
        Result.tryPromise({
          try: async () => updateAction(adapterInput),
          catch: (cause) => new ChatUpdateActionError({ chatId: String(input.chatId), cause }),
        }),
      );

      return Result.mapError(
        updated,
        (cause) => new ChatUpdateActionError({ chatId: String(input.chatId), cause }),
      ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatUpdateActionFailure>;
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
