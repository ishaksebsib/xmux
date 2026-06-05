import type {
  ChatActionEvent,
  ChatActor,
  ChatConversationRef,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ModelCommandResponseError } from "./errors";
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
  readonly event: ModelCommandEvent<Extract<keyof TChats, string>>;
}

export interface HandleModelActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ModelActionEvent<Extract<keyof TChats, string>>;
}

export interface ModelCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "model";
    readonly options: {
      readonly selector?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

export type ModelActionEvent<TChatId extends string = string> = ChatActionEvent<
  Actions,
  "model",
  TChatId,
  BetterResult<unknown, unknown>
>;

/** Handles `/model [providerId/modelId]` from any configured chat adapter. */
export async function handleModelCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleModelCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ModelCommandResponseError>> {
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

/** Handles a model action button press from a `/model` action message. */
export async function handleModelAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleModelActionInput<TAdapters, TChats>,
): Promise<BetterResult<void, ModelCommandResponseError>> {
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
  readonly result: BetterResult<ModelCommandOutput, ModelCommandError>;
  readonly maxSuggestions: number;
}): ChatTextInput {
  return Result.match(input.result, {
    ok: (value) => formatModelOutput(value),
    err: (error) => formatModelFailure(error, { maxSuggestions: input.maxSuggestions }),
  });
}

function replyModelCommand(input: {
  readonly event: ModelCommandEvent;
  readonly message: ChatTextInput;
}): Promise<BetterResult<void, ModelCommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: input.message,
    onError: (cause) => new ModelCommandResponseError({ cause }),
  });
}

async function sendModelPicker<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ModelCommandEvent<Extract<keyof TChats, string>>;
  readonly output: ModelShownOutput;
}): Promise<BetterResult<void, ModelCommandResponseError>> {
  const message = formatModelActionMessage(input.output);
  const sent = await input.ctx.app.chat.sendAction(toSendActionInput(input, message));

  return Result.map(
    Result.mapError(sent, (cause) => new ModelCommandResponseError({ cause })),
    () => undefined,
  );
}

function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: ModelCommandEvent<Extract<keyof TChats, string>>;
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
  respond: () => Promise<BetterResult<unknown, unknown>>,
): Promise<BetterResult<void, ModelCommandResponseError>> {
  const responded = await respond();

  return Result.map(
    Result.mapError(responded, (cause) => new ModelCommandResponseError({ cause })),
    () => undefined,
  );
}
