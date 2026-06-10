import { TaggedError } from "better-result";
import type { ChatAttachmentKind } from "@xmux/chat-core";
import type { SessionRef } from "@xmux/harness-core";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatSessionRef(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

/** Returned when a prompt is already running for a session. */
export class PromptAlreadyRunningError extends TaggedError("PromptAlreadyRunningError")<{
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly activeRequestId: string;
  readonly activeSince: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly sessionRef: SessionRef;
    readonly requestId: string;
    readonly activeRequestId: string;
    readonly activeSince: string;
  }) {
    super({
      ...args,
      message: `Session is already processing a prompt: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when there is no active prompt run for a session. */
export class PromptNoActiveRunError extends TaggedError("PromptNoActiveRunError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `No active prompt run for session: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when an active prompt run could not be cancelled. */
export class PromptRunCancellationError extends TaggedError("PromptRunCancellationError")<{
  readonly sessionRef: SessionRef;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to cancel prompt run for session ${formatSessionRef(args.sessionRef)}: ${describeCause(args.cause)}`,
    });
  }
}

/** Returned when there is no pending permission/question request to answer. */
export class PromptNoPendingInteractionError extends TaggedError(
  "PromptNoPendingInteractionError",
)<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `No pending prompt interaction for session: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when the current pending interaction cannot be handled by the command. */
export class PromptInteractionUnsupportedError extends TaggedError(
  "PromptInteractionUnsupportedError",
)<{
  readonly sessionRef: SessionRef;
  readonly kind: "permission" | "question";
  readonly action: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly sessionRef: SessionRef;
    readonly kind: "permission" | "question";
    readonly action: string;
  }) {
    super({
      ...args,
      message: `Cannot ${args.action} current ${args.kind} interaction for session: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when responding to a pending interaction failed. */
export class PromptInteractionResponseError extends TaggedError("PromptInteractionResponseError")<{
  readonly sessionRef: SessionRef;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to respond to prompt interaction for session ${formatSessionRef(args.sessionRef)}: ${describeCause(args.cause)}`,
    });
  }
}

/** Returned when a pending interaction is already being answered. */
export class PromptInteractionAlreadyRespondingError extends TaggedError(
  "PromptInteractionAlreadyRespondingError",
)<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `Prompt interaction is already being answered for session: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when the prompt response cannot be sent back to chat. */
export class PromptAttachmentUnsupportedError extends TaggedError(
  "PromptAttachmentUnsupportedError",
)<{
  readonly attachmentId: string;
  readonly kind: ChatAttachmentKind;
  readonly reason: "disabled" | "kind_disabled" | "missing_mime_type" | "model_unsupported";
  readonly message: string;
}>() {
  constructor(args: {
    readonly attachmentId: string;
    readonly kind: ChatAttachmentKind;
    readonly reason: "disabled" | "kind_disabled" | "missing_mime_type" | "model_unsupported";
    readonly detail?: string;
  }) {
    const fallback =
      args.reason === "disabled"
        ? "Attachments are disabled for prompts"
        : args.reason === "kind_disabled"
          ? `Attachment kind is disabled for prompts: ${args.kind}`
          : args.reason === "missing_mime_type"
            ? `Attachment is missing a MIME type: ${args.attachmentId}`
            : `The active model does not support this attachment: ${args.kind}`;

    super({ ...args, message: args.detail ?? fallback });
  }
}

export class PromptAttachmentReadError extends TaggedError("PromptAttachmentReadError")<{
  readonly attachmentId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly attachmentId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to read attachment ${args.attachmentId}: ${describeCause(args.cause)}`,
    });
  }
}

export class PromptAttachmentTooLargeError extends TaggedError("PromptAttachmentTooLargeError")<{
  readonly attachmentId: string;
  readonly maxBytes: number;
  readonly actualBytes?: number;
  readonly message: string;
}>() {
  constructor(args: {
    readonly attachmentId: string;
    readonly maxBytes: number;
    readonly actualBytes?: number;
  }) {
    const actual = args.actualBytes === undefined ? "" : ` (${args.actualBytes} bytes received)`;
    super({
      ...args,
      message: `Attachment ${args.attachmentId} exceeds the ${args.maxBytes} byte limit${actual}`,
    });
  }
}

export class PromptAttachmentStorageError extends TaggedError("PromptAttachmentStorageError")<{
  readonly attachmentId?: string;
  readonly operation: "create_temp_dir" | "write_temp_file";
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly attachmentId?: string;
    readonly operation: "create_temp_dir" | "write_temp_file";
    readonly cause: unknown;
  }) {
    const target = args.attachmentId === undefined ? "attachments" : `attachment ${args.attachmentId}`;
    super({
      ...args,
      message: `Failed to store ${target}: ${describeCause(args.cause)}`,
    });
  }
}

export type PromptAttachmentError =
  | PromptAttachmentUnsupportedError
  | PromptAttachmentReadError
  | PromptAttachmentTooLargeError
  | PromptAttachmentStorageError;

/** Returned when the prompt response cannot be sent back to chat. */
export class PromptResponseError extends TaggedError("PromptResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send prompt response: ${describeCause(args.cause)}` });
  }
}
