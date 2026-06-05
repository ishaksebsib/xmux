import type {
  ChatActionEvent,
  ChatActor,
  ChatAdapterDefinitions,
  ChatConversationRef,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ThinkingCommandResponseError } from "./errors";
import {
  formatThinkingActionMessage,
  formatThinkingFailure,
  formatThinkingOutput,
  type ThinkingActionMessage,
} from "./response";
import {
  thinkingSessionCommand,
  type ThinkingCommandError,
  type ThinkingCommandOutput,
} from "./service";

export interface HandleThinkingCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingCommandEvent<Extract<keyof TChats, string>>;
}

export interface HandleThinkingActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingActionEvent<Extract<keyof TChats, string>>;
}

export interface ThinkingCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "thinking";
    readonly options: {
      readonly level?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

export type ThinkingActionEvent<TChatId extends string = string> = ChatActionEvent<
  Actions,
  "thinking",
  TChatId,
  BetterResult<unknown, unknown>
>;

/** Handles `/thinking [level|clear]` from any configured chat adapter. */
export async function handleThinkingCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const level = input.event.command.options.level;
  const result = await selectThinking({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level,
  });

  if (level === undefined && result.isOk()) {
    return sendThinkingPicker({ ctx: input.ctx, event: input.event, output: result.value });
  }

  return replyThinkingCommand({
    event: input.event,
    message: formatThinkingResult(result),
  });
}

/** Handles a thinking level button press from a `/thinking` action message. */
export async function handleThinkingAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingActionInput<TAdapters, TChats>,
): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const acknowledged = await respondToThinkingAction(() => input.event.ack());
  if (acknowledged.isErr()) return Result.err(acknowledged.error);

  const result = await selectThinking({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level: input.event.value,
  });

  if (result.isErr()) {
    return respondToThinkingAction(() => input.event.reply(formatThinkingFailure(result.error)));
  }

  return updateThinkingPicker({ event: input.event, output: result.value });
}

function selectThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly level?: string;
}): Promise<BetterResult<ThinkingCommandOutput, ThinkingCommandError>> {
  return thinkingSessionCommand(input);
}

function formatThinkingResult(
  result: BetterResult<ThinkingCommandOutput, ThinkingCommandError>,
): ChatTextInput {
  return result.isOk() ? formatThinkingOutput(result.value) : formatThinkingFailure(result.error);
}

function replyThinkingCommand(input: {
  readonly event: ThinkingCommandEvent;
  readonly message: ChatTextInput;
}): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: input.message,
    onError: (cause) => new ThinkingCommandResponseError({ cause }),
  });
}

async function sendThinkingPicker<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingCommandEvent<Extract<keyof TChats, string>>;
  readonly output: ThinkingCommandOutput;
}): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const message = formatThinkingActionMessage(input.output);
  const sent = await Result.tryPromise({
    try: () => input.ctx.app.chat.sendAction(toSendActionInput(input, message)),
    catch: (cause) => new ThinkingCommandResponseError({ cause }),
  });

  return Result.andThen(sent, (chatResult) =>
    Result.map(
      Result.mapError(chatResult, (cause) => new ThinkingCommandResponseError({ cause })),
      () => undefined,
    ),
  );
}

function updateThinkingPicker(input: {
  readonly event: ThinkingActionEvent;
  readonly output: ThinkingCommandOutput;
}): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const message = formatThinkingActionMessage(input.output);

  return respondToThinkingAction(() =>
    input.event.update({
      message: toTextInput(message),
      buttons: message.buttons,
    }),
  );
}

function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: ThinkingCommandEvent<Extract<keyof TChats, string>>;
  },
  message: ThinkingActionMessage,
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

function toTextInput(message: ThinkingActionMessage): ChatTextInput {
  return message.format === undefined
    ? { text: message.text }
    : { text: message.text, format: message.format };
}

async function respondToThinkingAction(
  respond: () => Promise<BetterResult<unknown, unknown>>,
): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const responded = await Result.tryPromise({
    try: respond,
    catch: (cause) => new ThinkingCommandResponseError({ cause }),
  });

  return Result.andThen(responded, (chatResult) =>
    Result.map(
      Result.mapError(chatResult, (cause) => new ThinkingCommandResponseError({ cause })),
      () => undefined,
    ),
  );
}
