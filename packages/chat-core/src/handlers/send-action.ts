import { Result } from "better-result";
import { ChatSendActionError, type ChatSendActionFailure } from "../errors";
import type { ChatActionRegistry } from "../actions";
import type {
  ChatAdapterDefinitions,
  ChatSendActionInput,
  ChatSentMessageFromInput,
} from "../types";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendActionInput } from "./utils";

export function createSendActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
>(args: { readonly getStartedRuntime: GetStartedRuntime<TAdapters> }) {
  return async function sendAction<TInput extends ChatSendActionInput<TAdapters, TActions>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendActionFailure>> {
    return Result.gen(async function* () {
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
  };
}
