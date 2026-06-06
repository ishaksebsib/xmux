import type { ChatActionRegistry } from "../registry/actions";
import type {
  ChatAdapterActionResponse,
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatAdapterSendMessageInput,
  ChatAdapterSendTypingInput,
  ChatAdapterStreamMessageInput,
  ChatAdapterStreamReplyInput,
} from "../adapter/io";
import type { ChatAdapterDefinitions, AdapterOptionsFor } from "../adapter/registry";
import type { ChatAdapterObject, ChatMessageRef, ChatSentMessage } from "../contracts";
import type {
  ChatReplyInput,
  ChatSendActionInput,
  ChatSendMessageInput,
  ChatSentMessageFromInput,
  ChatStreamMessageInput,
  ChatStreamReplyInput,
  ChatTypingIndicatorInput,
} from "../inputs";
import type { RuntimeChatAdapterDefinition } from "./types";

export type RespondToActionInput<TChatId extends string = string> = {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly interactionId: string;
  readonly message: ChatMessageRef<TChatId>;
  readonly response: ChatAdapterActionResponse;
  readonly adapterOptions?: ChatAdapterObject;
  readonly signal?: AbortSignal;
};

export function adapterForChatId<TAdapters extends ChatAdapterDefinitions<TAdapters>>(
  adapters: TAdapters,
  chatId: Extract<keyof TAdapters, string>,
): RuntimeChatAdapterDefinition {
  return adapters[chatId];
}

export function sentMessageFromSameChatInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends { readonly chatId: keyof TAdapters },
>(
  message: ChatSentMessage<string, ChatAdapterObject>,
): ChatSentMessageFromInput<TAdapters, TInput> {
  return message as ChatSentMessageFromInput<TAdapters, TInput>;
}

export function createAdapterSendMessageInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatSendMessageInput<TAdapters> | ChatReplyInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    text: input.text,
    format: input.format,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendMessageInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

export function createAdapterSendActionInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TActions extends ChatActionRegistry,
  TInput extends ChatSendActionInput<TAdapters, TActions>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    text: input.text,
    format: input.format,
    buttons: input.buttons,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendActionInput<TInput["chatId"], AdapterOptionsFor<TAdapters, TInput["chatId"]>>;
}

export function createAdapterRespondToActionInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends RespondToActionInput<Extract<keyof TAdapters, string>>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    interactionId: input.interactionId,
    message: input.message,
    response: input.response,
    adapterOptions: input.adapterOptions ?? {},
    signal: input.signal,
  } as ChatAdapterRespondToActionInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

export function createAdapterTypingIndicatorInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatTypingIndicatorInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    ...(input.messageId === undefined
      ? {}
      : {
          message: {
            chatId: input.chatId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
        }),
    action: input.action ?? "typing",
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterSendTypingInput<TInput["chatId"], AdapterOptionsFor<TAdapters, TInput["chatId"]>>;
}

export function createAdapterStreamMessageInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamMessageInput<TAdapters> | ChatStreamReplyInput<TAdapters>,
>(input: TInput) {
  return {
    chatId: input.chatId,
    conversationId: input.conversationId,
    content: input.content,
    adapterOptions: "adapterOptions" in input ? input.adapterOptions : {},
    signal: input.signal,
  } as ChatAdapterStreamMessageInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}

export function createAdapterStreamReplyInput<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TInput extends ChatStreamReplyInput<TAdapters>,
>(input: TInput) {
  return {
    ...createAdapterStreamMessageInput<TAdapters, TInput>(input),
    ...(input.messageId === undefined
      ? {}
      : {
          message: {
            chatId: input.chatId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
        }),
    mode: input.mode ?? "auto",
  } as ChatAdapterStreamReplyInput<
    TInput["chatId"],
    AdapterOptionsFor<TAdapters, TInput["chatId"]>
  >;
}
