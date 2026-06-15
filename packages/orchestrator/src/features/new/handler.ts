import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { newHarnessActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  normalizeTextInput,
  replyWithResult,
  respondToAction,
  toSendActionInput,
  updateActionMessage,
  type CommandEvent,
  type ActionMessage,
  threadFromChatEvent,
} from "../utils";
import { createSessionForThread, newSessionCommand } from "./service";
import {
  formatNewHarnessActionMessage,
  formatNewOutput,
  formatNewSessionFailure,
  formatNewSessionSuccess,
} from "./response";

export interface HandleNewCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "new",
    { readonly harnessId?: string; readonly title?: string }
  >;
}

export interface HandleNewHarnessActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof newHarnessActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleNewCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleNewCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const result = await newSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    title: input.event.command.options.title,
  });

  if (result.isOk() && result.value.status === "harnesses" && result.value.harnessIds.length > 0) {
    const message = formatNewHarnessActionMessage(result.value);

    return respondToAction({
      command: "new",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  return replyWithResult({
    event: input.event,
    command: "new",
    result,
    ok: formatNewOutput,
    err: formatNewSessionFailure,
  });
}

export async function handleNewHarnessAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleNewHarnessActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "new",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const created = await createSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.payload,
  });

  if (created.isErr()) {
    return respondToAction({
      command: "new",
      respond: () => input.event.reply(formatNewSessionFailure(created.error)),
    });
  }

  const message = {
    ...normalizeTextInput(formatNewSessionSuccess(created.value)),
    buttons: [],
  } satisfies ActionMessage;

  return updateActionMessage({ command: "new", event: input.event, message });
}
