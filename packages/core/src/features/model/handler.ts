import type {
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyToChatEvent, threadFromChatEvent, type CommandEvent } from "../utils";
import {
  formatModelActionMessage,
  formatModelAvailableOutput,
  formatModelFailure,
  formatModelOutput,
  type ModelActionMessage,
} from "./response";
import {
  modelAvailableCommand,
  modelSessionCommand,
  type ModelCommandError,
  type ModelCommandOutput,
  type ModelShownOutput,
} from "./service";

export interface HandleModelCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "model",
    { readonly selector?: string }
  >;
}

export interface HandleModelActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    "model",
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleModelCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const selected = await modelSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    selector: input.event.command.options.selector,
  });

  if (
    input.event.command.options.selector === undefined &&
    selected.isOk() &&
    selected.value.status === "shown"
  ) {
    return sendModelPicker({ ctx: input.ctx, event: input.event, output: selected.value });
  }

  return replyModelCommand({
    event: input.event,
    message: formatModelResult({
      result: selected,
      maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
    }),
  });
}

export async function handleModelAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToModelAction(() => input.event.ack());
  if (acknowledged.isErr()) return Result.err(acknowledged.error);

  const available = await modelAvailableCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  return respondToModelAction(() =>
    input.event.reply(
      Result.match(available, {
        ok: (value) => formatModelAvailableOutput(value),
        err: (error) =>
          formatModelFailure(error, {
            maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
          }),
      }),
    ),
  );
}

function formatModelResult(input: {
  readonly result: Result<ModelCommandOutput, ModelCommandError>;
  readonly maxSuggestions: number;
}): ChatTextInput {
  return Result.match(input.result, {
    ok: (value) => formatModelOutput(value),
    err: (error) => formatModelFailure(error, { maxSuggestions: input.maxSuggestions }),
  });
}

function replyModelCommand(input: {
  readonly event: ChatEventWithReply;
  readonly message: ChatTextInput;
}): Promise<Result<void, CommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: input.message,
    onError: (cause) => new CommandResponseError({ command: "model", cause }),
  });
}

async function sendModelPicker<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "model">;
  readonly output: ModelShownOutput;
}): Promise<Result<void, CommandResponseError>> {
  const message = formatModelActionMessage(input.output);
  const sent = await input.ctx.app.chat.sendAction(toSendActionInput(input, message));

  return Result.map(
    Result.mapError(sent, (cause) => new CommandResponseError({ command: "model", cause })),
    () => undefined,
  );
}

function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: CommandEvent<Extract<keyof TChats, string>, "model">;
  },
  message: ModelActionMessage,
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

async function respondToModelAction(
  respond: () => Promise<Result<unknown, unknown>>,
): Promise<Result<void, CommandResponseError>> {
  const responded = await respond();

  return Result.map(
    Result.mapError(responded, (cause) => new CommandResponseError({ command: "model", cause })),
    () => undefined,
  );
}

type ChatEventWithReply = {
  readonly reply: (message: ChatTextInput) => Promise<Result<unknown, unknown>>;
};
