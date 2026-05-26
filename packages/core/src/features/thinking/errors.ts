import { TaggedError } from "better-result";
import type { HarnessThinkingLevel, SessionRef } from "@xmux/harness-core";
import type { ChatThreadRef } from "../../store";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatSessionRef(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

/** Returned when a chat thread is not attached to an active session. */
export class ThinkingNoActiveSessionError extends TaggedError("ThinkingNoActiveSessionError")<{
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
export class ThinkingSessionRecordMissingError extends TaggedError(
  "ThinkingSessionRecordMissingError",
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
export class ThinkingSessionClosedError extends TaggedError("ThinkingSessionClosedError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({ ...args, message: `Session is closed: ${formatSessionRef(args.sessionRef)}` });
  }
}

/** Returned when the requested thinking level is not a canonical harness level. */
export class ThinkingLevelInvalidError extends TaggedError("ThinkingLevelInvalidError")<{
  readonly selector: string;
  readonly availableLevels: readonly HarnessThinkingLevel[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly selector: string;
    readonly availableLevels: readonly HarnessThinkingLevel[];
  }) {
    super({ ...args, message: `Invalid thinking level: ${args.selector}` });
  }
}

/** Returned when the active harness reports that a canonical level is unavailable. */
export class ThinkingLevelUnsupportedError extends TaggedError("ThinkingLevelUnsupportedError")<{
  readonly level: HarnessThinkingLevel;
  readonly supportedLevels: readonly HarnessThinkingLevel[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly level: HarnessThinkingLevel;
    readonly supportedLevels: readonly HarnessThinkingLevel[];
  }) {
    super({ ...args, message: `Thinking level is not supported: ${args.level}` });
  }
}

/** Returned when the `/thinking` response cannot be sent back to chat. */
export class ThinkingCommandResponseError extends TaggedError("ThinkingCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send /thinking response: ${describeCause(args.cause)}` });
  }
}
