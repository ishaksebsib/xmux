import type {
  ChatActor,
  ChatAdapterDefinitions,
  ChatButton,
  ChatButtonInput,
  ChatConversationRef,
  ChatMessageFormat,
  ChatSendActionInput,
  ChatTextInput,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, HarnessModelRef } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../actions";
import type { Actor, HandlerContext } from "../ctx";
import type { ChatThreadRef } from "../store";
import { CommandResponseError } from "./errors";

export interface ChatEventWithConversation<TChatId extends string = string> {
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
}

export interface ChatEventWithReply {
  readonly reply: (message: ChatTextInput) => Promise<Result<unknown, unknown>>;
}

export interface ChatEventWithStreamReply {
  readonly replyStream: (
    content: ChatTextStreamContent,
    options?: { readonly mode?: "auto" | "thread" | "quote" | "conversation" },
  ) => Promise<Result<unknown, unknown>>;
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
}): Result<THarnessId, TError> {
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
}): Promise<Result<void, TError>> {
  const replied = await input.event.reply(input.message);

  return Result.map(Result.mapError(replied, input.onError), () => undefined);
}

export async function streamReplyToChatEvent<TError>(input: {
  readonly event: ChatEventWithStreamReply;
  readonly content: ChatTextStreamContent;
  readonly mode?: "auto" | "thread" | "quote" | "conversation";
  readonly onError: (cause: unknown) => TError;
}): Promise<Result<void, TError>> {
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
}): Promise<Result<InvalidCommandUsageReplyStatus, TError>> {
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
  readonly result: Result<TValue, TError>;
  readonly ok: (value: TValue) => ChatTextInput;
  readonly err: (error: TError) => ChatTextInput;
}): Promise<Result<void, CommandResponseError>> {
  const message = Result.match(input.result, { ok: input.ok, err: input.err });

  return replyToChatEvent({
    event: input.event,
    message,
    onError: (cause) => new CommandResponseError({ command: input.command, cause }),
  });
}

export function normalizeTextInput(input: ChatTextInput): {
  readonly text: string;
  readonly format?: ChatMessageFormat;
} {
  return typeof input === "string" ? { text: input } : input;
}

export function isSameModel(
  left: HarnessModelRef | undefined,
  right: HarnessModelRef | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant
  );
}

/**
 * Shared shape for action messages that carry text, format, and interactive
 * buttons. Used when command handlers send action messages via
 * `chat.sendAction` or update them in-place.
 */
export interface ActionMessage {
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly buttons: readonly (readonly ChatButtonInput<Actions>[])[];
}

/**
 * Minimal event interface for action message updates.
 * Handlers use `update` to replace the message text and buttons of a
 * previously-sent action without posting a new message.
 */
export type ChatActionUpdateEvent = {
  readonly update: (input: {
    readonly message?: ChatTextInput;
    readonly buttons?: readonly (readonly ChatButton[])[];
  }) => Promise<Result<unknown, unknown>>;
};

/**
 * Wraps a response callback (ack, reply, update, sendAction, …) and maps any
 * transport error to a `CommandResponseError` for `command`.
 *
 * Used across every feature that sends or updates chat actions.
 */
export async function respondToAction(input: {
  readonly command: string;
  readonly respond: () => Promise<Result<unknown, unknown>>;
}): Promise<Result<void, CommandResponseError>> {
  const responded = await input.respond();

  return Result.map(
    Result.mapError(
      responded,
      (cause) => new CommandResponseError({ command: input.command, cause }),
    ),
    () => undefined,
  );
}

/**
 * Updates an existing action message with a formatted `ActionMessage`.
 */
export function updateActionMessage(input: {
  readonly command: string;
  readonly event: ChatActionUpdateEvent;
  readonly message: ActionMessage;
}): Promise<Result<void, CommandResponseError>> {
  return respondToAction({
    command: input.command,
    respond: () =>
      input.event.update({
        message: { text: input.message.text, format: input.message.format },
        buttons: input.message.buttons,
      }),
  });
}

/**
 * Builds a `ChatSendActionInput` from the common context/event/message triple.
 */
export function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: ChatEventWithConversation<Extract<keyof TChats, string>>;
  },
  message: ActionMessage,
): ChatSendActionInput<TChats, Actions> {
  return {
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    text: message.text,
    format: message.format,
    buttons: message.buttons,
    signal: input.ctx.signal,
  } as ChatSendActionInput<TChats, Actions>;
}

/**
 * Parses a `"harnessId:shortId"` action payload into its components.
 */
export function parseActionPayload(payload: string): {
  readonly harnessId: string;
  readonly shortId: string;
} {
  const separatorIndex = payload.indexOf(":");

  if (separatorIndex < 1) {
    return { harnessId: "", shortId: "" };
  }

  return {
    harnessId: payload.slice(0, separatorIndex),
    shortId: payload.slice(separatorIndex + 1),
  };
}
