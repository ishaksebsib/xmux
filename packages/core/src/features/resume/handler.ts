import type {
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatButton,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { resumeHarnessActionId, resumeSessionActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  normalizeTextInput,
  replyToChatEvent,
  threadFromChatEvent,
  type CommandEvent,
} from "../utils";
import {
  formatResumeFailure,
  formatResumeHarnessActionMessage,
  formatResumeListActionMessage,
  formatResumeOutput,
  type ResumeActionMessage,
} from "./response";
import {
  listResumeSessionsForHarness,
  resumeSessionCommand,
  type ResumeCommandError,
  type ResumeCommandOutput,
} from "./service";

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
    return sendResumeActionMessage({
      ctx: input.ctx,
      event: input.event,
      message: formatResumeHarnessActionMessage(resumed.value),
    });
  }

  return replyResumeResult({ event: input.event, result: resumed });
}

export async function handleResumeHarnessAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleResumeHarnessActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToResumeAction(() => input.event.ack());
  if (acknowledged.isErr()) return acknowledged;

  const listed = await listResumeSessionsForHarness({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.payload,
  });

  if (listed.isErr()) {
    return respondToResumeAction(() => input.event.reply(formatResumeFailure(listed.error)));
  }

  return updateResumeActionMessage({
    event: input.event,
    message: formatResumeListActionMessage(listed.value),
  });
}

export async function handleResumeSessionAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleResumeSessionActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToResumeAction(() => input.event.ack());
  if (acknowledged.isErr()) return acknowledged;

  const target = parseResumeSessionActionPayload(input.event.payload);
  const resumed = await resumeSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: target.harnessId,
    shortId: target.shortId,
  });

  if (resumed.isErr()) {
    return respondToResumeAction(() => input.event.reply(formatResumeFailure(resumed.error)));
  }

  return updateResumeActionMessage({
    event: input.event,
    message: {
      ...normalizeTextInput(formatResumeOutput(resumed.value)),
      buttons: [],
    },
  });
}

function replyResumeResult(input: {
  readonly event: ChatEventWithReply;
  readonly result: Result<ResumeCommandOutput, ResumeCommandError>;
}): Promise<Result<void, CommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: formatResumeResult(input.result),
    onError: (cause) => new CommandResponseError({ command: "resume", cause }),
  });
}

function formatResumeResult(
  result: Result<ResumeCommandOutput, ResumeCommandError>,
): ChatTextInput {
  return Result.match(result, {
    ok: formatResumeOutput,
    err: formatResumeFailure,
  });
}

async function sendResumeActionMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "resume">;
  readonly message: ResumeActionMessage;
}): Promise<Result<void, CommandResponseError>> {
  const sent = await input.ctx.app.chat.sendAction(toSendActionInput(input, input.message));

  return Result.map(
    Result.mapError(sent, (cause) => new CommandResponseError({ command: "resume", cause })),
    () => undefined,
  );
}

function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: CommandEvent<Extract<keyof TChats, string>, "resume">;
  },
  message: ResumeActionMessage,
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

function updateResumeActionMessage(input: {
  readonly event: ChatActionUpdateEvent;
  readonly message: ResumeActionMessage;
}): Promise<Result<void, CommandResponseError>> {
  return respondToResumeAction(() =>
    input.event.update({
      message: { text: input.message.text, format: input.message.format },
      buttons: input.message.buttons,
    }),
  );
}

async function respondToResumeAction(
  respond: () => Promise<Result<unknown, unknown>>,
): Promise<Result<void, CommandResponseError>> {
  const responded = await respond();

  return Result.map(
    Result.mapError(responded, (cause) => new CommandResponseError({ command: "resume", cause })),
    () => undefined,
  );
}

function parseResumeSessionActionPayload(payload: string): {
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

type ChatEventWithReply = {
  readonly reply: (message: ChatTextInput) => Promise<Result<unknown, unknown>>;
};

type ChatActionUpdateEvent = {
  readonly update: (input: {
    readonly message?: ChatTextInput;
    readonly buttons?: readonly (readonly ChatButton[])[];
  }) => Promise<Result<unknown, unknown>>;
};
