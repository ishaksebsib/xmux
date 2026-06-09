import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { resumeHarnessActionId, resumeSessionActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  normalizeTextInput,
  parseActionPayload,
  replyWithResult,
  respondToAction,
  toSendActionInput,
  updateActionMessage,
  type CommandEvent,
  type ActionMessage,
  threadFromChatEvent,
} from "../utils";
import {
  formatResumeFailure,
  formatResumeHarnessActionMessage,
  formatResumeListActionMessage,
  formatResumeOutput,
} from "./response";
import { listResumeSessionsForHarness, resumeSessionCommand } from "./service";

export interface HandleResumeCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "resume",
    { readonly harnessId?: string; readonly shortId?: string }
  >;
}

export interface HandleResumeHarnessActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof resumeHarnessActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export interface HandleResumeSessionActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof resumeSessionActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleResumeCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleResumeCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const resumed = await resumeSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  if (
    resumed.isOk() &&
    resumed.value.status === "harnesses" &&
    resumed.value.harnessIds.length > 0
  ) {
    const message = formatResumeHarnessActionMessage(resumed.value);

    return respondToAction({
      command: "resume",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  if (resumed.isOk() && resumed.value.status === "listed" && isBareResumeCommand(input.event)) {
    const message = formatResumeListActionMessage(resumed.value);

    return respondToAction({
      command: "resume",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  return replyWithResult({
    event: input.event,
    command: "resume",
    result: resumed,
    ok: formatResumeOutput,
    err: formatResumeFailure,
  });
}

export async function handleResumeHarnessAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleResumeHarnessActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "resume",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const listed = await listResumeSessionsForHarness({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.payload,
  });

  if (listed.isErr()) {
    return respondToAction({
      command: "resume",
      respond: () => input.event.reply(formatResumeFailure(listed.error)),
    });
  }

  const message = formatResumeListActionMessage(listed.value);

  return updateActionMessage({ command: "resume", event: input.event, message });
}

function isBareResumeCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(event: HandleResumeCommandInput<TAdapters, TChats>["event"]): boolean {
  return (
    event.command.options.harnessId === undefined && event.command.options.shortId === undefined
  );
}

export async function handleResumeSessionAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleResumeSessionActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "resume",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const target = parseActionPayload(input.event.payload);
  const resumed = await resumeSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: target.harnessId,
    shortId: target.shortId,
  });

  if (resumed.isErr()) {
    return respondToAction({
      command: "resume",
      respond: () => input.event.reply(formatResumeFailure(resumed.error)),
    });
  }

  const message = {
    ...normalizeTextInput(formatResumeOutput(resumed.value)),
    buttons: [],
  } satisfies ActionMessage;

  return updateActionMessage({ command: "resume", event: input.event, message });
}
