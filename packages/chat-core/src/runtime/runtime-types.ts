import type { Result } from "better-result";
import type {
  AdapterDataByChatId,
  AdapterErrorByChatId,
  ChatAdapterDefinitions,
} from "../adapter/registry";
import type { ChatCommandRegistry } from "../registry/commands";
import type {
  ChatActionResponseFailure,
  ChatReplyFailure,
  ChatStreamReplyFailure,
} from "../errors";
import type { ChatAdapterEvent } from "../events/types";
import type { ChatReplyInput, ChatSentMessageFromInput, ChatStreamReplyInput } from "../inputs";

export type ChatId<TAdapters> = Extract<keyof TAdapters, string>;

export type EventResult<TAdapters extends ChatAdapterDefinitions<TAdapters>> =
  | Result<
      ChatSentMessageFromInput<
        TAdapters,
        ChatReplyInput<TAdapters> | ChatStreamReplyInput<TAdapters>
      >,
      ChatReplyFailure | ChatStreamReplyFailure
    >
  | Result<void, ChatActionResponseFailure>;

export type RuntimeAdapterEvent<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
  TCommands extends ChatCommandRegistry,
> = ChatAdapterEvent<
  TCommands,
  ChatId<TAdapters>,
  AdapterDataByChatId<TAdapters>,
  AdapterErrorByChatId<TAdapters>
>;
