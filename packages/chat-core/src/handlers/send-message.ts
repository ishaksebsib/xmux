import { Result } from "better-result";
import { ChatSendMessageError, type ChatSendMessageFailure } from "../errors";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatSendMessageInput, ChatSentMessageFromInput } from "../inputs";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendMessageInput } from "./adapter-inputs";

export function createSendMessageHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: { readonly getStartedRuntime: GetStartedRuntime<TAdapters> }) {
  return async function sendMessage<TInput extends ChatSendMessageInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatSendMessageFailure>> {
    return Result.gen(async function* () {
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
  };
}
