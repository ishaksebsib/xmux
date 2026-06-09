import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, HarnessThinkingLevel } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  replyWithResult,
  respondToAction,
  toSendActionInput,
  updateActionMessage,
  type CommandEvent,
  threadFromChatEvent,
} from "../utils";
import {
  formatModelActionMessage,
  formatModelFailure,
  formatModelOutput,
  formatModelProviderActionMessage,
  formatModelThinkingActionMessage,
  formatModelUpdatedActionMessage,
} from "./response";
import { ModelActionPayloadInvalidError } from "./errors";
import {
  modelActionSetCommand,
  modelActionSetThinkingCommand,
  modelProviderCommand,
  modelSessionCommand,
  type ModelCommandError,
  type ModelCommandOutput,
} from "./service";
import { isThinkingLevel } from "../thinking/selector";

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
    const message = formatModelActionMessage(selected.value);

    return respondToAction({
      command: "model",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  return replyWithResult({
    event: input.event,
    command: "model",
    result: selected,
    ok: formatModelOutput,
    err: (error) =>
      formatModelFailure(error, {
        maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
      }),
  });
}

export async function handleModelAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "model",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  switch (input.event.value) {
    case "available":
      return updateModelProviderPicker(input);
    case "p":
      return updateModelProviderModels(input);
    case "m":
      return updateSelectedModel(input);
    case "t":
      return updateSelectedModelThinking(input);
  }
}

async function updateModelProviderPicker<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const result = await modelSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  if (result.isOk() && result.value.status === "shown") {
    const message = formatModelActionMessage(result.value);
    return updateActionMessage({ command: "model", event: input.event, message });
  }

  return replyWithModelResult({ input, result });
}

async function updateModelProviderModels<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const providerIndex = parseProviderPayload(input.event.payload);

  if (providerIndex.isErr()) {
    return replyWithModelFailure({ input, error: providerIndex.error });
  }

  const result = await modelProviderCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    providerIndex: providerIndex.value,
  });

  if (result.isOk()) {
    const message = formatModelProviderActionMessage(result.value);
    return updateActionMessage({ command: "model", event: input.event, message });
  }

  return replyWithModelFailure({ input, error: result.error });
}

async function updateSelectedModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const selection = parseModelPayload(input.event.payload);

  if (selection.isErr()) {
    return replyWithModelFailure({ input, error: selection.error });
  }

  const result = await modelActionSetCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    providerIndex: selection.value.providerIndex,
    modelIndex: selection.value.modelIndex,
  });

  if (result.isOk()) {
    const message =
      result.value.status === "thinking"
        ? formatModelThinkingActionMessage(result.value)
        : formatModelUpdatedActionMessage(result.value);
    return updateActionMessage({ command: "model", event: input.event, message });
  }

  return replyWithModelFailure({ input, error: result.error });
}

async function updateSelectedModelThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleModelActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const selection = parseModelThinkingPayload(input.event.payload);

  if (selection.isErr()) {
    return replyWithModelFailure({ input, error: selection.error });
  }

  const result = await modelActionSetThinkingCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    providerIndex: selection.value.providerIndex,
    modelIndex: selection.value.modelIndex,
    level: selection.value.level,
  });

  if (result.isOk()) {
    const message = formatModelUpdatedActionMessage(result.value);
    return updateActionMessage({ command: "model", event: input.event, message });
  }

  return replyWithModelFailure({ input, error: result.error });
}

function replyWithModelResult<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly input: HandleModelActionInput<TAdapters, TChats>;
  readonly result: Result<ModelCommandOutput, ModelCommandError>;
}): Promise<Result<void, CommandResponseError>> {
  return respondToAction({
    command: "model",
    respond: () =>
      input.input.event.reply(
        Result.match(input.result, {
          ok: (value) => formatModelOutput(value),
          err: (error) => formatModelFailureForAction(input.input, error),
        }),
      ),
  });
}

function replyWithModelFailure<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly input: HandleModelActionInput<TAdapters, TChats>;
  readonly error: Parameters<typeof formatModelFailure>[0];
}): Promise<Result<void, CommandResponseError>> {
  return respondToAction({
    command: "model",
    respond: () => input.input.event.reply(formatModelFailureForAction(input.input, input.error)),
  });
}

function formatModelFailureForAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleModelActionInput<TAdapters, TChats>,
  error: Parameters<typeof formatModelFailure>[0],
) {
  return formatModelFailure(error, {
    maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
  });
}

function parseProviderPayload(
  payload: string | undefined,
): Result<number, ModelActionPayloadInvalidError> {
  if (payload === undefined || !/^\d+$/.test(payload)) {
    return Result.err(
      new ModelActionPayloadInvalidError({
        payload: payload ?? "",
        reason: "provider index is missing or invalid",
      }),
    );
  }

  return Result.ok(Number(payload));
}

function parseModelPayload(payload: string | undefined): Result<
  {
    readonly providerIndex: number;
    readonly modelIndex: number;
  },
  ModelActionPayloadInvalidError
> {
  const [providerIndex, modelIndex, extra] = payload?.split(":") ?? [];

  if (
    providerIndex === undefined ||
    modelIndex === undefined ||
    extra !== undefined ||
    !/^\d+$/.test(providerIndex) ||
    !/^\d+$/.test(modelIndex)
  ) {
    return Result.err(
      new ModelActionPayloadInvalidError({
        payload: payload ?? "",
        reason: "model index is missing or invalid",
      }),
    );
  }

  return Result.ok({
    providerIndex: Number(providerIndex),
    modelIndex: Number(modelIndex),
  });
}

function parseModelThinkingPayload(payload: string | undefined): Result<
  {
    readonly providerIndex: number;
    readonly modelIndex: number;
    readonly level: HarnessThinkingLevel;
  },
  ModelActionPayloadInvalidError
> {
  const [providerIndex, modelIndex, level, extra] = payload?.split(":") ?? [];

  if (
    providerIndex === undefined ||
    modelIndex === undefined ||
    level === undefined ||
    extra !== undefined ||
    !/^\d+$/.test(providerIndex) ||
    !/^\d+$/.test(modelIndex) ||
    !isThinkingLevel(level)
  ) {
    return Result.err(
      new ModelActionPayloadInvalidError({
        payload: payload ?? "",
        reason: "thinking level selection is missing or invalid",
      }),
    );
  }

  return Result.ok({
    providerIndex: Number(providerIndex),
    modelIndex: Number(modelIndex),
    level,
  });
}
