import type {
  AdapterDataFor,
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatAttachment,
  ChatInjectMessageInputFor,
  ChatUpdateActionInputFor,
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
} from "../utils";
import type { PromptMessageEvent } from "../prompt";
import { composePromptFromTranscript, startSttRun, transcribeAudioAttachment } from "./service";
import {
  formatSttCancelledAction,
  formatSttDisabledMessage,
  formatSttFailedAction,
  formatSttNotRunningAction,
  formatSttSendRetryAction,
  formatSttSendUnavailableAction,
  formatSttSentAction,
  formatSttStartedAction,
  formatSttTranscriptAction,
  formatSttUnsupportedMessage,
} from "./response";
import {
  SttResponseError,
  SttRunActorMismatchError,
  SttRunNotReadyError,
  SttRunStateConflictError,
  SttUnexpectedTranscriptionError,
  type SttTranscribeError,
  type SttUnsupportedAudioMessageError,
} from "./errors";
import type { SttRun } from "./run-registry";

export interface HandleSttAudioMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent<TChatId, AdapterDataFor<TChats, TChatId>>;
  readonly attachment: ChatAttachment;
}

export interface HandleSttUnsupportedMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string> = Extract<keyof TChats, string>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly event: PromptMessageEvent<TChatId, AdapterDataFor<TChats, TChatId>>;
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

  input.ctx.app.services.sttRuns.pruneExpired(input.ctx.app.services.now().toISOString());

  const run = startSttRun(input);
  const sent = await input.ctx.app.chat.sendAction(
    toSendActionInput(input, formatSttStartedAction(run.runId)),
  );

  if (sent.isErr()) {
    input.ctx.app.services.sttRuns.cancel(
      run.runId,
      "failed to send transcribing message",
      input.ctx.app.services.now().toISOString(),
    );
    input.ctx.app.services.sttRuns.delete(run.runId);
    return Result.err(new SttResponseError({ operation: "started", cause: sent.error }));
  }

  const attached = input.ctx.app.services.sttRuns.attachActionMessage(
    run.runId,
    {
      chatId: sent.value.chatId,
      conversationId: sent.value.conversationId,
      messageId: sent.value.messageId,
    },
    input.ctx.app.services.now().toISOString(),
  );

  if (attached.isErr()) {
    input.ctx.app.services.sttRuns.delete(run.runId);
    return Result.err(new SttResponseError({ operation: "attach_action", cause: attached.error }));
  }

  void completeSttRun({ ...input, runId: run.runId }).catch((cause: unknown) => {
    input.ctx.app.services.sttRuns.fail(
      run.runId,
      new SttUnexpectedTranscriptionError({ cause }),
      input.ctx.app.services.now().toISOString(),
    );
  });
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
): Promise<ResultType<void, SttResponseError>> {
  input.ctx.app.services.sttRuns.pruneExpired(input.ctx.app.services.now().toISOString());

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
  try {
    const current = input.ctx.app.services.sttRuns.get(input.runId);
    if (!current || current.state !== "transcribing") return;

    const transcript = await transcribeAudioAttachment({
      ctx: input.ctx,
      attachment: input.attachment,
      signal: current.signal,
    });

    if (transcript.isErr()) {
      await failBackgroundTranscription({ ...input, error: transcript.error });
      return;
    }

    const completed = input.ctx.app.services.sttRuns.complete<
      typeof input.event.chatId,
      AdapterDataFor<TChats, typeof input.event.chatId>
    >(input.runId, transcript.value, input.ctx.app.services.now().toISOString());
    if (completed.isErr() || completed.value.state !== "awaiting_send") return;

    const updated = await updateRunAction({
      ctx: input.ctx,
      run: completed.value,
      input: formatSttTranscriptAction({ runId: input.runId, transcript: transcript.value }),
    });

    if (updated.isErr()) return;
  } catch (cause) {
    await failBackgroundTranscription({
      ...input,
      error: new SttUnexpectedTranscriptionError({ cause }),
    });
  }
}

async function failBackgroundTranscription<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleSttAudioMessageInput<TAdapters, TChats> & {
    readonly runId: string;
    readonly error: SttTranscribeError;
  },
): Promise<void> {
  const failed = input.ctx.app.services.sttRuns.fail<
    typeof input.event.chatId,
    AdapterDataFor<TChats, typeof input.event.chatId>
  >(input.runId, input.error, input.ctx.app.services.now().toISOString());
  if (failed.isErr() || failed.value.state === "cancelled") return;

  try {
    await updateRunAction({
      ctx: input.ctx,
      run: failed.value,
      input: formatSttFailedAction(input.error),
    });
  } finally {
    input.ctx.app.services.sttRuns.delete(input.runId);
  }
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
  if (run !== undefined && !isRequesterAction(input.ctx.actor?.userId, run)) {
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: formatSttSendUnavailableAction(
          new SttRunActorMismatchError({ runId: input.runId }),
        ),
      }),
      (cause) => new SttResponseError({ operation: "cancel", cause }),
    );
  }

  const message =
    !run || run.state !== "transcribing" ? formatSttNotRunningAction() : formatSttCancelledAction();

  const shouldDelete = run?.state === "transcribing";
  if (shouldDelete) {
    input.ctx.app.services.sttRuns.cancel(
      input.runId,
      "cancelled by user",
      input.ctx.app.services.now().toISOString(),
    );
  }

  const updated = Result.mapError(
    await updateActionMessage({ command: "stt", event: input.event, message }),
    (cause) => new SttResponseError({ operation: "cancel", cause }),
  );
  if (shouldDelete) input.ctx.app.services.sttRuns.delete(input.runId);
  return updated;
}

async function sendSttTranscript<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: HandleSttActionInput<TAdapters, TChats>["event"];
  readonly runId: string;
}): Promise<ResultType<void, SttResponseError>> {
  const existingRun = input.ctx.app.services.sttRuns.get<
    typeof input.event.chatId,
    AdapterDataFor<TChats, typeof input.event.chatId>
  >(input.runId);
  if (existingRun !== undefined && !isRequesterAction(input.ctx.actor?.userId, existingRun)) {
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: formatSttSendUnavailableAction(
          new SttRunActorMismatchError({ runId: input.runId }),
        ),
      }),
      (cause) => new SttResponseError({ operation: "send_actor_mismatch", cause }),
    );
  }

  const sending = input.ctx.app.services.sttRuns.markSending<
    typeof input.event.chatId,
    AdapterDataFor<TChats, typeof input.event.chatId>
  >(input.runId, input.ctx.app.services.now().toISOString());

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
    await revertSending(input.ctx, input.runId);
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

  const injected = await input.ctx.app.chat.injectMessage(
    createTranscriptInjectMessageInput<TChats, typeof input.event.chatId>({
      chatId: input.event.chatId,
      run,
      text: transcriptPromptText(run),
    }),
  );

  if (injected.isErr()) {
    await revertSending(input.ctx, input.runId);
    return Result.mapError(
      await updateActionMessage({
        command: "stt",
        event: input.event,
        message: formatSttSendRetryAction({
          runId: input.runId,
          message: "Failed to send transcription to the prompt flow. Press Send to retry.",
        }),
      }),
      (cause) => new SttResponseError({ operation: "inject_retry_update", cause }),
    );
  }

  input.ctx.app.services.sttRuns.markSent(input.runId, input.ctx.app.services.now().toISOString());
  input.ctx.app.services.sttRuns.delete(input.runId);

  const sentUpdate = await updateActionMessage({
    command: "stt",
    event: input.event,
    message: formatSttSentAction(),
  });
  if (sentUpdate.isErr()) {
    return Result.err(new SttResponseError({ operation: "sent_update", cause: sentUpdate.error }));
  }

  return Result.ok();
}

async function updateRunAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly run: SttRun<TChatId>;
  readonly input: ReturnType<
    | typeof formatSttTranscriptAction
    | typeof formatSttFailedAction
    | typeof formatSttSendRetryAction
  >;
}): Promise<ResultType<void, SttResponseError>> {
  if (input.run.actionMessage === undefined) {
    return Result.err(
      new SttResponseError({
        operation: "update_action",
        cause: new SttRunStateConflictError({
          runId: input.run.runId,
          state: input.run.state,
          message: "STT run has no action message to update.",
        }),
      }),
    );
  }

  const updated = await input.ctx.app.chat.updateAction(
    createUpdateRunActionInput({ ctx: input.ctx, run: input.run, action: input.input }),
  );

  return Result.mapError(
    Result.map(updated, () => undefined),
    (cause) => new SttResponseError({ operation: "update_action", cause }),
  );
}

function createUpdateRunActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats, TChatId>;
  readonly run: SttRun<TChatId>;
  readonly action: ReturnType<
    | typeof formatSttTranscriptAction
    | typeof formatSttFailedAction
    | typeof formatSttSendRetryAction
  >;
}): ChatUpdateActionInputFor<TChats, Actions, TChatId> {
  return {
    chatId: input.ctx.chatId as Extract<TChatId, string>,
    conversationId: input.run.actionMessage?.conversationId ?? input.run.message.conversationId,
    messageId: input.run.actionMessage?.messageId ?? input.run.message.messageId,
    text: input.action.text,
    format: input.action.format,
    buttons: input.action.buttons,
    signal: input.ctx.signal,
  } as ChatUpdateActionInputFor<TChats, Actions, TChatId>;
}

function createTranscriptInjectMessageInput<
  TChats extends ChatAdapterDefinitions<TChats>,
  TChatId extends Extract<keyof TChats, string>,
>(input: {
  readonly chatId: TChatId;
  readonly run: SttRun<TChatId, AdapterDataFor<TChats, TChatId>>;
  readonly text: string;
}): ChatInjectMessageInputFor<TChats, TChatId> {
  return {
    chatId: input.chatId as Extract<TChatId, string>,
    conversationId: input.run.message.conversationId,
    messageId: input.run.message.messageId,
    actor: input.run.actor,
    text: input.text,
    format: "plain",
    attachments: [],
    adapterData: input.run.adapterData,
  };
}

async function revertSending<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: HandlerContext<TAdapters, TChats>, runId: string): Promise<void> {
  ctx.app.services.sttRuns.markAwaitingSend(runId, ctx.app.services.now().toISOString());
}

function isRequesterAction(actorUserId: string | undefined, run: SttRun): boolean {
  return run.requester === undefined || actorUserId === run.requester.userId;
}

function transcriptPromptText(run: SttRun): string {
  if (run.transcript === undefined) return "";
  return composePromptFromTranscript({ caption: run.caption, transcript: run.transcript });
}
