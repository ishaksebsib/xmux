import type {
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatAttachment,
  ChatTextInput,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { sttActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import {
  replyToChatEvent,
  respondToAction,
  toSendActionInput,
  updateActionMessage,
  type ActionMessage,
} from "../utils";
import {
  promptSessionForThread,
  streamPromptReplyInMessages,
  type PromptMessageEvent,
} from "../prompt";
import { PromptResponseError } from "../prompt/errors";
import { formatPromptFailure } from "../prompt/response";
import { composePromptFromTranscript, startSttRun, transcribeAudioAttachment } from "./service";
import {
  formatSttCancelledAction,
  formatSttDisabledMessage,
  formatSttFailedMessage,
  formatSttNotRunningAction,
  formatSttSendUnavailableAction,
  formatSttSendingAction,
  formatSttSentAction,
  formatSttStartedAction,
  formatSttTranscriptAction,
  formatSttUnsupportedMessage,
} from "./response";
import {
  SttResponseError,
  SttRunNotReadyError,
  type SttUnsupportedAudioMessageError,
} from "./errors";
import type { SttRun } from "./run-registry";

export interface HandleSttAudioMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent<Extract<keyof TChats, string>>;
  readonly attachment: ChatAttachment;
}

export interface HandleSttUnsupportedMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent<Extract<keyof TChats, string>>;
  readonly error: SttUnsupportedAudioMessageError;
}

export interface HandleSttActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof sttActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleSttAudioMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleSttAudioMessageInput<TAdapters, TChats>,
): Promise<ResultType<void, SttResponseError>> {
  if (!input.ctx.app.config.stt.enabled) {
    return replyToChatEvent({
      event: input.event,
      message: formatSttDisabledMessage(),
      onError: (cause) => new SttResponseError({ operation: "disabled", cause }),
    });
  }

  const run = startSttRun(input);
  const sent = await input.ctx.app.chat.sendAction(
    toSendActionInput(input, formatSttStartedAction(run.runId)),
  );
  if (sent.isErr()) {
    return Result.err(new SttResponseError({ operation: "started", cause: sent.error }));
  }

  void completeSttRun({ ...input, runId: run.runId });
  return Result.ok();
}

export function handleSttUnsupportedMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleSttUnsupportedMessageInput<TAdapters, TChats>,
): Promise<ResultType<void, SttResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: formatSttUnsupportedMessage(input.error),
    onError: (cause) => new SttResponseError({ operation: "unsupported", cause }),
  });
}

export async function handleSttAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleSttActionInput<TAdapters, TChats>,
): Promise<ResultType<void, SttResponseError | PromptResponseError>> {
  const acked = await respondToAction({ command: "stt", respond: () => input.event.ack() });
  if (acked.isErr()) {
    return Result.err(new SttResponseError({ operation: "ack", cause: acked.error }));
  }

  switch (input.event.value) {
    case "cancel":
      return cancelSttRun({ ctx: input.ctx, event: input.event, runId: input.event.payload });
    case "send":
      return sendSttTranscript({ ctx: input.ctx, event: input.event, runId: input.event.payload });
  }

  const exhaustive: never = input.event;
  return exhaustive;
}

async function completeSttRun<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleSttAudioMessageInput<TAdapters, TChats> & { readonly runId: string },
): Promise<void> {
  const current = input.ctx.app.services.sttRuns.get(input.runId);
  if (!current || current.state !== "transcribing") return;

  const transcript = await transcribeAudioAttachment({
    ctx: input.ctx,
    attachment: input.attachment,
    signal: current.signal,
  });

  if (transcript.isErr()) {
    const failed = input.ctx.app.services.sttRuns.fail(
      input.runId,
      transcript.error,
      input.ctx.app.services.now().toISOString(),
    );
    if (failed.isErr() || failed.value.state === "cancelled") return;

    await replyToChatEvent({
      event: input.event,
      message: formatSttFailedMessage(transcript.error),
      onError: (cause) => new SttResponseError({ operation: "failed", cause }),
    });
    return;
  }

  const completed = input.ctx.app.services.sttRuns.complete(
    input.runId,
    transcript.value,
    input.ctx.app.services.now().toISOString(),
  );
  if (completed.isErr() || completed.value.state !== "awaiting_send") return;

  await input.ctx.app.chat.sendAction(
    toSendActionInput(
      input,
      formatSttTranscriptAction({ runId: input.runId, transcript: transcript.value }),
    ),
  );
}

async function cancelSttRun<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: HandleSttActionInput<TAdapters, TChats>["event"];
  readonly runId: string;
}): Promise<ResultType<void, SttResponseError>> {
  const run = input.ctx.app.services.sttRuns.get(input.runId);
  const message =
    !run || run.state !== "transcribing" ? formatSttNotRunningAction() : formatSttCancelledAction();

  if (run?.state === "transcribing") {
    input.ctx.app.services.sttRuns.cancel(
      input.runId,
      "cancelled by user",
      input.ctx.app.services.now().toISOString(),
    );
  }

  return Result.mapError(
    await updateActionMessage({ command: "stt", event: input.event, message }),
    (cause) => new SttResponseError({ operation: "cancel", cause }),
  );
}

async function sendSttTranscript<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: HandleSttActionInput<TAdapters, TChats>["event"];
  readonly runId: string;
}): Promise<ResultType<void, SttResponseError | PromptResponseError>> {
  const sending = input.ctx.app.services.sttRuns.markSending(
    input.runId,
    input.ctx.app.services.now().toISOString(),
  );

  if (sending.isErr()) {
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: formatSttSendUnavailableAction(sending.error),
      }),
      (cause) => new SttResponseError({ operation: "send_unavailable", cause }),
    );
  }

  const run = sending.value;
  if (run.transcript === undefined) {
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: formatSttSendUnavailableAction(
          new SttRunNotReadyError({ runId: input.runId, state: run.state }),
        ),
      }),
      (cause) => new SttResponseError({ operation: "send_unavailable", cause }),
    );
  }

  const updated = await updateActionMessage({
    command: "stt",
    event: input.event,
    message: formatSttSendingAction(),
  });
  if (updated.isErr()) {
    return Result.err(new SttResponseError({ operation: "sending", cause: updated.error }));
  }

  const promptText = composePromptFromTranscript({
    caption: run.caption,
    transcript: run.transcript,
  });
  const prompted = await promptSessionForThread({
    ctx: input.ctx,
    thread: run.thread,
    text: promptText,
    attachments: [],
  });

  if (prompted.isErr()) {
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: textInputToActionMessage(formatPromptFailure(prompted.error)),
      }),
      (cause) => new SttResponseError({ operation: "prompt_failure", cause }),
    );
  }

  const streamed = await streamPromptReplyInMessages({
    ctx: input.ctx,
    session: prompted.value.session,
    event: promptEventFromRun({ event: input.event, run, text: promptText }),
    events: prompted.value.events,
    responseConfig: input.ctx.app.config.prompt.response,
  });

  if (streamed.isErr()) {
    prompted.value.cancel(streamed.error);
    prompted.value.release();
    return streamed;
  }

  input.ctx.app.services.sttRuns.markSent(input.runId, input.ctx.app.services.now().toISOString());
  return Result.mapError(
    await updateActionMessage({
      command: "stt",
      event: input.event,
      message: formatSttSentAction(),
    }),
    (cause) => new SttResponseError({ operation: "sent", cause }),
  );
}

function promptEventFromRun<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly event: HandleSttActionInput<TAdapters, TChats>["event"];
  readonly run: SttRun;
  readonly text: string;
}): PromptMessageEvent<Extract<keyof TChats, string>> {
  return {
    type: "message",
    chatId: input.event.chatId,
    conversation: input.run.conversation as PromptMessageEvent<
      Extract<keyof TChats, string>
    >["conversation"],
    message: {
      ...input.run.message,
      actor: input.event.actor ?? input.run.actor,
      text: input.text,
      format: "plain",
      attachments: [],
      adapterData: {},
    } as unknown as PromptMessageEvent<Extract<keyof TChats, string>>["message"],
    reply: input.event.reply,
    replyStream: (content) => replyWithCollectedStream({ event: input.event, content }),
  };
}

async function replyWithCollectedStream(input: {
  readonly event: {
    readonly reply: (message: ChatTextInput) => Promise<ResultType<unknown, unknown>>;
  };
  readonly content: ChatTextStreamContent;
}): Promise<ResultType<unknown, unknown>> {
  let text = "";

  for await (const chunk of input.content.chunks) {
    if (chunk.type === "delta") {
      text += chunk.delta;
      continue;
    }

    if (chunk.text !== undefined) text = chunk.text;
  }

  return input.event.reply({ text, format: input.content.format });
}

function textInputToActionMessage(input: ChatTextInput): ActionMessage {
  const normalized = typeof input === "string" ? { text: input } : input;
  return { text: normalized.text, format: normalized.format, buttons: [] };
}
