import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { deleteHarnessActionId, deleteSessionActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  parseActionPayload,
  replyWithResult,
  respondToAction,
  toSendActionInput,
  updateActionMessage,
  type CommandEvent,
  threadFromChatEvent,
} from "../utils";
import {
  formatDeleteFailure,
  formatDeleteHarnessActionMessage,
  formatDeleteListActionMessage,
  formatDeleteOutput,
} from "./response";
import { deleteSessionCommand, listDeleteSessionsForHarness } from "./service";

export interface HandleDeleteCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "delete",
    { readonly harnessId?: string; readonly shortId?: string }
  >;
}

export interface HandleDeleteHarnessActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof deleteHarnessActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export interface HandleDeleteSessionActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof deleteSessionActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleDeleteCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleDeleteCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  if (
    deleted.isOk() &&
    deleted.value.status === "harnesses" &&
    deleted.value.harnessIds.length > 0
  ) {
    const message = formatDeleteHarnessActionMessage(deleted.value);

    return respondToAction({
      command: "delete",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  if (deleted.isOk() && deleted.value.status === "listed" && isBareDeleteCommand(input.event)) {
    const message = formatDeleteListActionMessage(deleted.value);

    return respondToAction({
      command: "delete",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  return replyWithResult({
    event: input.event,
    command: "delete",
    result: deleted,
    ok: formatDeleteOutput,
    err: formatDeleteFailure,
  });
}

export async function handleDeleteHarnessAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleDeleteHarnessActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "delete",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const listed = await listDeleteSessionsForHarness({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.payload,
  });

  if (listed.isOk()) {
    const message = formatDeleteListActionMessage(listed.value);

    return updateActionMessage({ command: "delete", event: input.event, message });
  }

  return respondToAction({
    command: "delete",
    respond: () =>
      input.event.reply(Result.match(listed, { ok: formatDeleteOutput, err: formatDeleteFailure })),
  });
}

function isBareDeleteCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: HandleDeleteCommandInput<TAdapters, TChats>["event"]): boolean {
  return (
    event.command.options.harnessId === undefined && event.command.options.shortId === undefined
  );
}

export async function handleDeleteSessionAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleDeleteSessionActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "delete",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const target = parseActionPayload(input.event.payload);
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: target.harnessId,
    shortId: target.shortId,
  });

  if (deleted.isErr()) {
    return respondToAction({
      command: "delete",
      respond: () => input.event.reply(formatDeleteFailure(deleted.error)),
    });
  }

  const listed = await listDeleteSessionsForHarness({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: target.harnessId,
  });

  if (listed.isOk()) {
    const message = formatDeleteListActionMessage(listed.value);

    return updateActionMessage({ command: "delete", event: input.event, message });
  }

  return respondToAction({
    command: "delete",
    respond: () => input.event.reply(formatDeleteFailure(listed.error)),
  });
}
