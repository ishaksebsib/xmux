import { Result } from "better-result";
import type { ChatAdapterReplyInput } from "../adapter/io";
import {
  ChatReplyError,
  ChatSendMessageError,
  UnsupportedChatOperationError,
  type ChatReplyFailure,
} from "../errors";
import type { AdapterOptionsFor, ChatAdapterDefinitions } from "../adapter/registry";
import type { ChatReplyInput, ChatSentMessageFromInput } from "../inputs";
import type { GetStartedRuntime } from "./types";
import { createAdapterSendMessageInput } from "./adapter-inputs";

export function createReplyHandler<TAdapters extends ChatAdapterDefinitions<TAdapters>>(args: {
  readonly getStartedRuntime: GetStartedRuntime<TAdapters>;
}) {
  return async function reply<TInput extends ChatReplyInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>> {
    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getStartedRuntime({ chatId: input.chatId, operation: "reply" }),
      );
      const mode = input.mode ?? "auto";

      if (runtime.reply) {
        const adapterReplyInput = {
          ...createAdapterSendMessageInput<TAdapters, TInput>(input),
          ...(input.messageId === undefined
            ? {}
            : {
                message: {
                  chatId: input.chatId,
                  conversationId: input.conversationId,
                  messageId: input.messageId,
                },
              }),
          mode,
        } as ChatAdapterReplyInput<
          TInput["chatId"],
          AdapterOptionsFor<TAdapters, TInput["chatId"]>
        >;

        const replyResult = yield* Result.await(
          Result.tryPromise({
            try: async () => runtime.reply?.(adapterReplyInput),
            catch: (cause) => new ChatReplyError({ chatId: input.chatId, cause }),
          }),
        );

        if (replyResult === undefined) {
          return Result.err(
            new UnsupportedChatOperationError({
              chatId: input.chatId,
              operation: "reply",
              mode,
            }),
          );
        }

        return Result.mapError(
          replyResult,
          (cause) => new ChatReplyError({ chatId: input.chatId, cause }),
        ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>;
      }

      if (mode !== "auto" && mode !== "conversation") {
        return Result.err(
          new UnsupportedChatOperationError({
            chatId: input.chatId,
            operation: "reply",
            mode,
          }),
        );
      }

      const sent = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            runtime.sendMessage(createAdapterSendMessageInput<TAdapters, TInput>(input)),
          catch: (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
        }),
      );

      return Result.mapError(
        sent,
        (cause) => new ChatSendMessageError({ chatId: input.chatId, cause }),
      ) as Result<ChatSentMessageFromInput<TAdapters, TInput>, ChatReplyFailure>;
    });
  };
}
