import { TaggedError } from "better-result";
import type { ChatAttachmentKind } from "@xmux/chat-core";
import type { SpeechToTextClientError, SpeechToTextCreateClientError } from "@xmux/stt";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class SttUnsupportedAudioMessageError extends TaggedError(
  "SttUnsupportedAudioMessageError",
)<{
  readonly reason: "multiple_audio" | "mixed_attachments";
  readonly audioCount: number;
  readonly attachmentKinds: readonly ChatAttachmentKind[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly reason: "multiple_audio" | "mixed_attachments";
    readonly audioCount: number;
    readonly attachmentKinds: readonly ChatAttachmentKind[];
  }) {
    super({
      ...args,
      message:
        args.reason === "multiple_audio"
          ? "Multiple audio attachments are not supported yet. Send one voice/audio message at a time."
          : "Audio messages mixed with other attachments are not supported yet.",
    });
  }
}

export class SttDisabledError extends TaggedError("SttDisabledError")<{
  readonly message: string;
}>() {
  constructor() {
    super({ message: "STT is not enabled." });
  }
}

export class SttClientCreateError extends TaggedError("SttClientCreateError")<{
  readonly cause: SpeechToTextCreateClientError;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: SpeechToTextCreateClientError }) {
    super({ cause: args.cause, message: args.cause.message });
  }
}

export class SttAttachmentReadError extends TaggedError("SttAttachmentReadError")<{
  readonly attachmentId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly attachmentId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to read audio attachment ${args.attachmentId}: ${describeCause(args.cause)}`,
    });
  }
}

export class SttAttachmentTooLargeError extends TaggedError("SttAttachmentTooLargeError")<{
  readonly attachmentId: string;
  readonly maxBytes: number;
  readonly actualBytes: number;
  readonly message: string;
}>() {
  constructor(args: {
    readonly attachmentId: string;
    readonly maxBytes: number;
    readonly actualBytes: number;
  }) {
    super({
      ...args,
      message: `Audio attachment ${args.attachmentId} is too large (${args.actualBytes} bytes, max ${args.maxBytes} bytes)`,
    });
  }
}

export class SttUnexpectedTranscriptionError extends TaggedError(
  "SttUnexpectedTranscriptionError",
)<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      cause: args.cause,
      message: `Unexpected transcription failure: ${describeCause(args.cause)}`,
    });
  }
}

export class SttTranscriptionError extends TaggedError("SttTranscriptionError")<{
  readonly cause: SpeechToTextClientError;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: SpeechToTextClientError }) {
    super({ cause: args.cause, message: args.cause.message });
  }
}

export class SttRunNotFoundError extends TaggedError("SttRunNotFoundError")<{
  readonly runId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly runId: string }) {
    super({ ...args, message: "This transcription request is no longer available." });
  }
}

export class SttRunNotReadyError extends TaggedError("SttRunNotReadyError")<{
  readonly runId: string;
  readonly state: string;
  readonly message: string;
}>() {
  constructor(args: { readonly runId: string; readonly state: string }) {
    super({ ...args, message: "Transcription is not ready to send yet." });
  }
}

export class SttRunActorMismatchError extends TaggedError("SttRunActorMismatchError")<{
  readonly runId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly runId: string }) {
    super({ ...args, message: "Only the requester can use this transcription action." });
  }
}

export class SttRunStateConflictError extends TaggedError("SttRunStateConflictError")<{
  readonly runId: string;
  readonly state: string;
  readonly message: string;
}>() {
  constructor(args: { readonly runId: string; readonly state: string; readonly message: string }) {
    super(args);
  }
}

export class SttResponseError extends TaggedError("SttResponseError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly operation: string; readonly cause: unknown }) {
    super({ ...args, message: `Failed to send STT ${args.operation} response` });
  }
}

export type SttTranscribeError =
  | SttDisabledError
  | SttClientCreateError
  | SttAttachmentReadError
  | SttAttachmentTooLargeError
  | SttUnexpectedTranscriptionError
  | SttTranscriptionError;

export type SttSendTranscriptError =
  | SttRunNotFoundError
  | SttRunNotReadyError
  | SttRunActorMismatchError
  | SttRunStateConflictError;
