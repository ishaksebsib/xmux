import { TaggedError } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type { ChatThreadRef } from "../store";
import { describeCause } from "../utils";

function formatSessionRef(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

/**
 * Returned when a command response (or its usage reply) cannot be sent back to
 * chat. Shared across every command feature; `command` is the command token
 * used in the diagnostic message, for example `cancel` or `model`.
 */
export class CommandResponseError extends TaggedError("CommandResponseError")<{
  readonly command: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly command: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send /${args.command} response: ${describeCause(args.cause)}`,
    });
  }
}

/** Returned when a chat thread is not attached to an active session. */
export class NoActiveSessionError extends TaggedError("NoActiveSessionError")<{
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
export class SessionRecordMissingError extends TaggedError("SessionRecordMissingError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({ ...args, message: `Session record not found: ${formatSessionRef(args.sessionRef)}` });
  }
}

/** Failure resolving the active session bound to a chat thread. */
export type ActiveSessionError = NoActiveSessionError | SessionRecordMissingError;

/** Returned when a command targets a harness that is not configured. */
export class CommandHarnessNotConfiguredError extends TaggedError(
  "CommandHarnessNotConfiguredError",
)<{
  readonly harnessId: string;
  readonly availableHarnessIds: readonly string[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly harnessId: string;
    readonly availableHarnessIds: readonly string[];
  }) {
    super({
      ...args,
      message: `Unknown harness '${args.harnessId}'. Available harnesses: ${
        args.availableHarnessIds.join(", ") || "none"
      }`,
    });
  }
}
