import type {
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import { CommandResponseError } from "../errors";
import { replyToChatEvent, threadFromChatEvent, type CommandEvent } from "../utils";
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
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "thinking",
    { readonly level?: string }
  >;
}

export interface HandleThinkingActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    "thinking",
    Extract<keyof TChats, string>,
    BetterResult<unknown, unknown>
  >;
}

export async function handleThinkingCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CommandResponseError>> {
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

export async function handleThinkingAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingActionInput<TAdapters, TChats>,
): Promise<BetterResult<void, CommandResponseError>> {
  const acknowledged = await respondToThinkingAction(() => input.event.ack());
  if (acknowledged.isErr()) return Result.err(acknowledged.error);

  const result = await selectThinking({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level: input.event.value,
  });

  return Result.match(result, {
    ok: (value) => updateThinkingPicker({ event: input.event, output: value }),
    err: (error) => respondToThinkingAction(() => input.event.reply(formatThinkingFailure(error))),
  });
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
  return Result.match(result, {
    ok: (value) => formatThinkingOutput(value),
    err: (error) => formatThinkingFailure(error),
  });
}

function replyThinkingCommand(input: {
  readonly event: ChatEventWithReply;
  readonly message: ChatTextInput;
}): Promise<BetterResult<void, CommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: input.message,
    onError: (cause) => new CommandResponseError({ command: "thinking", cause }),
  });
}

async function sendThinkingPicker<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "thinking">;
  readonly output: ThinkingCommandOutput;
}): Promise<BetterResult<void, CommandResponseError>> {
  const message = formatThinkingActionMessage(input.output);
  const sent = await input.ctx.app.chat.sendAction(toSendActionInput(input, message));

  return Result.map(
    Result.mapError(sent, (cause) => new CommandResponseError({ command: "thinking", cause })),
    () => undefined,
  );
}

function updateThinkingPicker(input: {
  readonly event: ChatActionEvent<Actions, "thinking", string, BetterResult<unknown, unknown>>;
  readonly output: ThinkingCommandOutput;
}): Promise<BetterResult<void, CommandResponseError>> {
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
    readonly event: CommandEvent<Extract<keyof TChats, string>, "thinking">;
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
): Promise<BetterResult<void, CommandResponseError>> {
  const responded = await respond();

  return Result.map(
    Result.mapError(responded, (cause) => new CommandResponseError({ command: "thinking", cause })),
    () => undefined,
  );
}

type ChatEventWithReply = {
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
};
