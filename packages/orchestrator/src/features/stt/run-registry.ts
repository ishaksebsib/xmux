import { randomBytes } from "node:crypto";
import type {
  ChatActor,
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessageRef,
} from "@xmux/chat-core";
import { Result, type Result as ResultType } from "better-result";
import type { Actor } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import {
  SttRunNotFoundError,
  SttRunNotReadyError,
  SttRunStateConflictError,
  type SttTranscribeError,
} from "./errors";

export const DEFAULT_STT_RUN_TTL_MS = 15 * 60 * 1000;

export type SttRunState =
  | "transcribing"
  | "cancelled"
  | "failed"
  | "awaiting_send"
  | "sending"
  | "sent";

export interface SttRun<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly runId: string;
  readonly state: SttRunState;
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly actionMessage?: ChatMessageRef<TChatId>;
  readonly caption: string;
  readonly actor: ChatActor<TAdapterData>;
  readonly adapterData: TAdapterData;
  readonly requester?: Actor;
  readonly attachmentId: string;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly transcript?: string;
  readonly error?: SttTranscribeError;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SttRunStartInput<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly caption: string;
  readonly actor: ChatActor<TAdapterData>;
  readonly adapterData: TAdapterData;
  readonly requester?: Actor;
  readonly attachmentId: string;
  readonly now: string;
}

export interface SttRunRegistry {
  start<TChatId extends string, TAdapterData extends ChatAdapterObject>(
    input: SttRunStartInput<TChatId, TAdapterData>,
  ): SttRun<TChatId, TAdapterData>;
  get<TChatId extends string = string, TAdapterData extends ChatAdapterObject = ChatAdapterObject>(
    runId: string,
  ): SttRun<TChatId, TAdapterData> | undefined;
  attachActionMessage<TChatId extends string = string>(
    runId: string,
    message: ChatMessageRef<TChatId>,
    now: string,
  ): ResultType<SttRun<TChatId>, SttRunNotFoundError | SttRunStateConflictError>;
  complete<
    TChatId extends string = string,
    TAdapterData extends ChatAdapterObject = ChatAdapterObject,
  >(
    runId: string,
    transcript: string,
    now: string,
  ): ResultType<SttRun<TChatId, TAdapterData>, SttRunNotFoundError | SttRunStateConflictError>;
  fail<TChatId extends string = string, TAdapterData extends ChatAdapterObject = ChatAdapterObject>(
    runId: string,
    error: SttTranscribeError,
    now: string,
  ): ResultType<SttRun<TChatId, TAdapterData>, SttRunNotFoundError | SttRunStateConflictError>;
  cancel<TChatId extends string = string>(
    runId: string,
    reason: unknown,
    now: string,
  ): ResultType<SttRun<TChatId>, SttRunNotFoundError>;
  markSending<
    TChatId extends string = string,
    TAdapterData extends ChatAdapterObject = ChatAdapterObject,
  >(
    runId: string,
    now: string,
  ): ResultType<
    SttRun<TChatId, TAdapterData>,
    SttRunNotFoundError | SttRunNotReadyError | SttRunStateConflictError
  >;
  markAwaitingSend(
    runId: string,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunStateConflictError>;
  markSent(
    runId: string,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunStateConflictError>;
  delete(runId: string): boolean;
  pruneExpired(now: string): number;
}

export function createSttRunRegistry(input: { readonly ttlMs?: number } = {}): SttRunRegistry {
  const ttlMs = input.ttlMs ?? DEFAULT_STT_RUN_TTL_MS;
  const runs = new Map<string, MutableSttRun>();

  return {
    start<TChatId extends string, TAdapterData extends ChatAdapterObject>(
      input: SttRunStartInput<TChatId, TAdapterData>,
    ) {
      pruneExpiredRuns(runs, input.now, ttlMs);
      const runId = createRunId((candidate) => !runs.has(candidate));
      const run = new MutableSttRun({ ...input, runId });
      runs.set(runId, run);
      return run.snapshot() as SttRun<TChatId, TAdapterData>;
    },

    get<
      TChatId extends string = string,
      TAdapterData extends ChatAdapterObject = ChatAdapterObject,
    >(runId: string) {
      return runs.get(runId)?.snapshot() as SttRun<TChatId, TAdapterData> | undefined;
    },

    attachActionMessage<TChatId extends string = string>(
      runId: string,
      message: ChatMessageRef<TChatId>,
      now: string,
    ) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.attachActionMessage(message, now) as ResultType<
        SttRun<TChatId>,
        SttRunStateConflictError
      >;
    },

    complete<
      TChatId extends string = string,
      TAdapterData extends ChatAdapterObject = ChatAdapterObject,
    >(runId: string, transcript: string, now: string) {
      pruneExpiredRuns(runs, now, ttlMs);
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.complete(transcript, now) as ResultType<
        SttRun<TChatId, TAdapterData>,
        SttRunStateConflictError
      >;
    },

    fail<
      TChatId extends string = string,
      TAdapterData extends ChatAdapterObject = ChatAdapterObject,
    >(runId: string, error: SttTranscribeError, now: string) {
      pruneExpiredRuns(runs, now, ttlMs);
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.fail(error, now) as ResultType<
        SttRun<TChatId, TAdapterData>,
        SttRunStateConflictError
      >;
    },

    cancel<TChatId extends string = string>(runId: string, reason: unknown, now: string) {
      pruneExpiredRuns(runs, now, ttlMs);
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      run.cancel(reason, now);
      return Result.ok(run.snapshot()) as ResultType<SttRun<TChatId>, SttRunNotFoundError>;
    },

    markSending<
      TChatId extends string = string,
      TAdapterData extends ChatAdapterObject = ChatAdapterObject,
    >(runId: string, now: string) {
      pruneExpiredRuns(runs, now, ttlMs);
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.markSending(now) as ResultType<
        SttRun<TChatId, TAdapterData>,
        SttRunNotReadyError | SttRunStateConflictError
      >;
    },

    markAwaitingSend(runId, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.markAwaitingSend(now);
    },

    markSent(runId, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.markSent(now);
    },

    delete(runId) {
      return runs.delete(runId);
    },

    pruneExpired(now) {
      return pruneExpiredRuns(runs, now, ttlMs);
    },
  };
}

class MutableSttRun {
  private stateValue: SttRunState = "transcribing";
  private actionMessageValue: ChatMessageRef | undefined;
  private transcriptValue: string | undefined;
  private errorValue: SttTranscribeError | undefined;
  private updatedAtValue: string;

  readonly runId: string;
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef;
  readonly message: ChatMessageRef;
  readonly caption: string;
  readonly actor: ChatActor;
  readonly adapterData: ChatAdapterObject;
  readonly requester?: Actor;
  readonly attachmentId: string;
  readonly controller = new AbortController();
  readonly createdAt: string;

  constructor(input: SttRunStartInput & { readonly runId: string }) {
    this.runId = input.runId;
    this.thread = input.thread;
    this.conversation = input.conversation;
    this.message = input.message;
    this.caption = input.caption;
    this.actor = input.actor;
    this.adapterData = input.adapterData;
    this.requester = input.requester;
    this.attachmentId = input.attachmentId;
    this.createdAt = input.now;
    this.updatedAtValue = input.now;
  }

  get state(): SttRunState {
    return this.stateValue;
  }

  get updatedAt(): string {
    return this.updatedAtValue;
  }

  snapshot(): SttRun {
    return {
      runId: this.runId,
      state: this.stateValue,
      thread: { ...this.thread },
      conversation: { ...this.conversation },
      message: { ...this.message },
      ...(this.actionMessageValue === undefined
        ? {}
        : { actionMessage: { ...this.actionMessageValue } }),
      caption: this.caption,
      actor: this.actor,
      adapterData: this.adapterData,
      ...(this.requester === undefined ? {} : { requester: this.requester }),
      attachmentId: this.attachmentId,
      controller: this.controller,
      signal: this.controller.signal,
      ...(this.transcriptValue === undefined ? {} : { transcript: this.transcriptValue }),
      ...(this.errorValue === undefined ? {} : { error: this.errorValue }),
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
    };
  }

  attachActionMessage(
    message: ChatMessageRef,
    now: string,
  ): ResultType<SttRun, SttRunStateConflictError> {
    if (this.stateValue !== "transcribing") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Action message can only be attached while transcribing.",
        }),
      );
    }

    this.actionMessageValue = { ...message };
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }

  complete(transcript: string, now: string): ResultType<SttRun, SttRunStateConflictError> {
    if (this.stateValue === "cancelled") return Result.ok(this.snapshot());
    if (this.stateValue !== "transcribing") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription can only complete while transcribing.",
        }),
      );
    }

    this.stateValue = "awaiting_send";
    this.transcriptValue = transcript;
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }

  fail(error: SttTranscribeError, now: string): ResultType<SttRun, SttRunStateConflictError> {
    if (this.stateValue === "cancelled") return Result.ok(this.snapshot());
    if (this.stateValue !== "transcribing" && this.stateValue !== "awaiting_send") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription can only fail before it is sent.",
        }),
      );
    }

    this.stateValue = "failed";
    this.errorValue = error;
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }

  cancel(reason: unknown, now: string): void {
    if (this.stateValue !== "transcribing") return;
    this.stateValue = "cancelled";
    this.updatedAtValue = now;
    if (!this.controller.signal.aborted) this.controller.abort(reason);
  }

  markSending(now: string): ResultType<SttRun, SttRunNotReadyError | SttRunStateConflictError> {
    if (this.stateValue !== "awaiting_send") {
      if (this.stateValue === "transcribing") {
        return Result.err(new SttRunNotReadyError({ runId: this.runId, state: this.stateValue }));
      }

      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription cannot be sent from its current state.",
        }),
      );
    }

    this.stateValue = "sending";
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }

  markAwaitingSend(now: string): ResultType<SttRun, SttRunStateConflictError> {
    if (this.stateValue !== "sending") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription can only be made retryable while sending.",
        }),
      );
    }

    this.stateValue = "awaiting_send";
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }

  markSent(now: string): ResultType<SttRun, SttRunStateConflictError> {
    if (this.stateValue !== "sending") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription can only be marked sent while sending.",
        }),
      );
    }

    this.stateValue = "sent";
    this.updatedAtValue = now;
    return Result.ok(this.snapshot());
  }
}

function createRunId(isAvailable: (candidate: string) => boolean): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomBytes(6).toString("base64url");
    if (isAvailable(candidate)) return candidate;
  }

  return randomBytes(9).toString("base64url");
}

function pruneExpiredRuns(runs: Map<string, MutableSttRun>, now: string, ttlMs: number): number {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return 0;

  let deleted = 0;
  for (const [runId, run] of runs) {
    if (!isPrunableState(run.state)) continue;
    const updatedAtMs = Date.parse(run.updatedAt);
    if (!Number.isFinite(updatedAtMs)) continue;
    if (nowMs - updatedAtMs <= ttlMs) continue;
    runs.delete(runId);
    deleted += 1;
  }

  return deleted;
}

function isPrunableState(state: SttRunState): boolean {
  return (
    state === "awaiting_send" || state === "cancelled" || state === "failed" || state === "sent"
  );
}
