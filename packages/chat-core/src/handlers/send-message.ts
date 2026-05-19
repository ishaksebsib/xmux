import { Result } from "better-result";
import { ChatSendMessageError, type ChatSendMessageFailure } from "../errors";
import type {
  ChatAdapterDefinitions,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
} from "../types";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendMessageInput } from "./utils";

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

      const sentResult = yield* Result.await(
        Result.tryPromise({
          try: async () => runtime.sendMessage(adapterInput),
          catch: (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
        }),
      );

      if (sentResult.isErr()) {
        return Result.err(
          new ChatSendMessageError({ chatId: input.chatId, cause: sentResult.error }),
        );
      }

      return Result.ok(sentResult.value as ChatSentMessageFromInput<TAdapters, TInput>);
    });
  };
}
