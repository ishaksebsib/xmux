import { TaggedError } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type { ChatThreadRef } from "../../store";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatSessionRef(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

/** Returned when a chat thread is not attached to an active session. */
export class PromptNoActiveSessionError extends TaggedError("PromptNoActiveSessionError")<{
  readonly thread: ChatThreadRef;
  readonly message: string;
}>() {
  constructor(args: { readonly thread: ChatThreadRef }) {
    super({
      ...args,
      message: `No active session for thread ${args.thread.chatId}:${args.thread.threadId}`,
    });
  }
}

/** Returned when a thread binding points at a missing session record. */
export class PromptSessionRecordMissingError extends TaggedError(
  "PromptSessionRecordMissingError",
)<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `Session record not found: ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

/** Returned when a thread binding points at a closed session. */
export class PromptSessionClosedError extends TaggedError("PromptSessionClosedError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `Session is closed: ${formatSessionRef(args.sessionRef)}`,
    });
  }
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

/** Returned when the prompt response cannot be sent back to chat. */
export class PromptResponseError extends TaggedError("PromptResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send prompt response: ${describeCause(args.cause)}` });
  }
}
