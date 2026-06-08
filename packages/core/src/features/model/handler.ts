import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  replyWithResult,
  respondToAction,
  toSendActionInput,
  type CommandEvent,
  threadFromChatEvent,
} from "../utils";
import {
  formatModelActionMessage,
  formatModelAvailableOutput,
  formatModelFailure,
  formatModelOutput,
} from "./response";
import { modelAvailableCommand, modelSessionCommand } from "./service";

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

  const available = await modelAvailableCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  return respondToAction({
    command: "model",
    respond: () =>
      input.event.reply(
        Result.match(available, {
          ok: (value) => formatModelAvailableOutput(value),
          err: (error) =>
            formatModelFailure(error, {
              maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
            }),
        }),
      ),
  });
}
