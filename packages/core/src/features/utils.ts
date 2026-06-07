import type {
  ChatActor,
  ChatConversationRef,
  ChatTextInput,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actor } from "../ctx";
import type { ChatThreadRef } from "../store";
import { CommandResponseError } from "./errors";

export interface ChatEventWithConversation<TChatId extends string = string> {
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
}

export interface ChatEventWithReply {
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

export interface ChatEventWithStreamReply {
  readonly replyStream: (
    content: ChatTextStreamContent,
    options?: { readonly mode?: "auto" | "thread" | "quote" | "conversation" },
  ) => Promise<BetterResult<unknown, unknown>>;
}

export interface InvalidCommandEvent extends ChatEventWithReply {
  readonly commandName: string;
  readonly reason: string;
  readonly optionName?: string;
}

/**
 * Minimal shape of a routed slash-command event consumed by command handlers.
 *
 * The concrete chat-core `ChatCommandEvent` is structurally assignable to this,
 * so routes hand handlers the inferred event directly without casts. `reply`
 * is typed as a `Result` (its true runtime shape) so handlers compose it with
 * the better-result combinators.
 */
export interface CommandEvent<
  TChatId extends string = string,
  TName extends string = string,
  TOptions = Record<never, never>,
>
  extends ChatEventWithConversation<TChatId>, ChatEventWithReply {
  readonly type: "command";
  readonly actor?: ChatActor;
  readonly command: { readonly name: TName; readonly options: TOptions };
}

export type InvalidCommandUsageReplyStatus = "ignored" | "replied";

export function threadFromChatEvent<TChatId extends string>(
  event: ChatEventWithConversation<TChatId>,
): ChatThreadRef<TChatId> {
  return {
    chatId: event.chatId,
    threadId: event.conversation.conversationId,
  };
}

export function actorFromChatActor(actor: ChatActor | undefined): Actor | undefined {
  if (!actor) {
    return undefined;
  }

  return {
    userId: actor.actorId ?? "system",
    ...(actor.displayName === undefined ? {} : { displayName: actor.displayName }),
  };
}

export function requireConfiguredHarnessId<THarnessId extends string, TError>(input: {
  readonly harnessId: string;
  readonly availableHarnessIds: readonly THarnessId[];
  readonly onMissing: (args: {
    readonly harnessId: string;
    readonly availableHarnessIds: readonly THarnessId[];
  }) => TError;
}): BetterResult<THarnessId, TError> {
  return input.availableHarnessIds.includes(input.harnessId as THarnessId)
    ? Result.ok(input.harnessId as THarnessId)
    : Result.err(
        input.onMissing({
          harnessId: input.harnessId,
          availableHarnessIds: input.availableHarnessIds,
        }),
      );
}

export async function replyToChatEvent<TError>(input: {
  readonly event: ChatEventWithReply;
  readonly message: ChatTextInput;
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<void, TError>> {
  const replied = await input.event.reply(input.message);

  return Result.map(Result.mapError(replied, input.onError), () => undefined);
}

export async function streamReplyToChatEvent<TError>(input: {
  readonly event: ChatEventWithStreamReply;
  readonly content: ChatTextStreamContent;
  readonly mode?: "auto" | "thread" | "quote" | "conversation";
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<void, TError>> {
  const replied = await input.event.replyStream(
    input.content,
    input.mode === undefined ? undefined : { mode: input.mode },
  );

  return Result.map(Result.mapError(replied, input.onError), () => undefined);
}

export async function replyToInvalidCommandUsage<TError>(input: {
  readonly event: InvalidCommandEvent;
  readonly commandName: string;
  readonly usage: ChatTextInput;
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<InvalidCommandUsageReplyStatus, TError>> {
  if (input.event.commandName !== input.commandName) {
    return Result.ok("ignored");
  }

  const replied = await replyToChatEvent({
    event: input.event,
    message: input.usage,
    onError: input.onError,
  });

  return Result.map(replied, () => "replied" as const);
}

/**
 * Formats a `Result` into a chat message and sends it back as a command reply.
 * Shared tail for command handlers: match → format → reply, wrapping any
 * transport failure as a `CommandResponseError` for `command`.
 */
export async function replyWithResult<TValue, TError>(input: {
  readonly event: ChatEventWithReply;
  readonly command: string;
  readonly result: BetterResult<TValue, TError>;
  readonly ok: (value: TValue) => ChatTextInput;
  readonly err: (error: TError) => ChatTextInput;
}): Promise<BetterResult<void, CommandResponseError>> {
  const message = Result.match(input.result, { ok: input.ok, err: input.err });

  return replyToChatEvent({
    event: input.event,
    message,
    onError: (cause) => new CommandResponseError({ command: input.command, cause }),
  });
}
