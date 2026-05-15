import type {
  ChatConversationRef,
  ChatMessage,
  ChatMessageRef,
  ChatSentMessage,
} from "./contracts";

export type ChatIdFromConversation<TConversation extends ChatConversationRef> =
  TConversation["chatId"];

export type ChatIdFromMessageRef<TMessageRef extends ChatMessageRef> = TMessageRef["chatId"];

export type AdapterDataFromMessage<TMessage extends ChatMessage> = TMessage["adapterData"];

export type AdapterDataFromSentMessage<TMessage extends ChatSentMessage> =
  TMessage["adapterData"];
