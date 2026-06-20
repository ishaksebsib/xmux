import { randomUUID } from "node:crypto";
import type { ChatActor, ChatConversationRef, ChatMessageRef } from "@xmux/chat-core";
import { Result, type Result as ResultType } from "better-result";
import type { Actor } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import {
  SttRunNotFoundError,
  SttRunNotReadyError,
  SttRunStateConflictError,
  type SttTranscribeError,
} from "./errors";

export type SttRunState =
  | "transcribing"
  | "cancelled"
  | "failed"
  | "awaiting_send"
  | "sending"
  | "sent";

export interface SttRun {
  readonly runId: string;
  readonly state: SttRunState;
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef;
  readonly message: ChatMessageRef;
  readonly caption: string;
  readonly actor: ChatActor;
  readonly requester?: Actor;
  readonly attachmentId: string;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly transcript?: string;
  readonly error?: SttTranscribeError;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SttRunStartInput {
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef;
  readonly message: ChatMessageRef;
  readonly caption: string;
  readonly actor: ChatActor;
  readonly requester?: Actor;
  readonly attachmentId: string;
  readonly now: string;
}

export interface SttRunRegistry {
  start(input: SttRunStartInput): SttRun;
  get(runId: string): SttRun | undefined;
  complete(
    runId: string,
    transcript: string,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunStateConflictError>;
  fail(
    runId: string,
    error: SttTranscribeError,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunStateConflictError>;
  cancel(runId: string, reason: unknown, now: string): ResultType<SttRun, SttRunNotFoundError>;
  markSending(
    runId: string,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunNotReadyError | SttRunStateConflictError>;
  markSent(
    runId: string,
    now: string,
  ): ResultType<SttRun, SttRunNotFoundError | SttRunStateConflictError>;
}

export function createSttRunRegistry(): SttRunRegistry {
  const runs = new Map<string, MutableSttRun>();

  return {
    start(input) {
      const runId = createRunId((candidate) => !runs.has(candidate));
      const run = new MutableSttRun({ ...input, runId });
      runs.set(runId, run);
      return run.snapshot();
    },

    get(runId) {
      return runs.get(runId)?.snapshot();
    },

    complete(runId, transcript, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.complete(transcript, now);
    },

    fail(runId, error, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.fail(error, now);
    },

    cancel(runId, reason, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      run.cancel(reason, now);
      return Result.ok(run.snapshot());
    },

    markSending(runId, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.markSending(now);
    },

    markSent(runId, now) {
      const run = runs.get(runId);
      if (!run) return Result.err(new SttRunNotFoundError({ runId }));
      return run.markSent(now);
    },
  };
}

class MutableSttRun {
  private stateValue: SttRunState = "transcribing";
  private transcriptValue: string | undefined;
  private errorValue: SttTranscribeError | undefined;
  private updatedAtValue: string;

  readonly runId: string;
  readonly thread: ChatThreadRef;
  readonly conversation: ChatConversationRef;
  readonly message: ChatMessageRef;
  readonly caption: string;
  readonly actor: ChatActor;
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
    this.requester = input.requester;
    this.attachmentId = input.attachmentId;
    this.createdAt = input.now;
    this.updatedAtValue = input.now;
  }

  snapshot(): SttRun {
    return {
      runId: this.runId,
      state: this.stateValue,
      thread: { ...this.thread },
      conversation: { ...this.conversation },
      message: { ...this.message },
      caption: this.caption,
      actor: this.actor,
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
    if (this.stateValue !== "transcribing") {
      return Result.err(
        new SttRunStateConflictError({
          runId: this.runId,
          state: this.stateValue,
          message: "Transcription can only fail while transcribing.",
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
    const candidate = Math.random().toString(36).slice(2, 10);
    if (candidate.length > 0 && isAvailable(candidate)) return candidate;
  }

  return randomUUID().replaceAll("-", "").slice(0, 12);
}
