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
export class ModelNoActiveSessionError extends TaggedError("ModelNoActiveSessionError")<{
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
export class ModelSessionRecordMissingError extends TaggedError("ModelSessionRecordMissingError")<{
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
export class ModelSessionClosedError extends TaggedError("ModelSessionClosedError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({ ...args, message: `Session is closed: ${formatSessionRef(args.sessionRef)}` });
  }
}

/** Returned when a model selector cannot be parsed. */
export class ModelSelectorInvalidError extends TaggedError("ModelSelectorInvalidError")<{
  readonly selector: string;
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly reason: string }) {
    super({ ...args, message: `Invalid model selector '${args.selector}': ${args.reason}` });
  }
}

/** Returned when a model selector does not match available models. */
export class ModelSelectorNotFoundError extends TaggedError("ModelSelectorNotFoundError")<{
  readonly selector: string;
  readonly availableSelectors: readonly string[];
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly availableSelectors: readonly string[] }) {
    super({ ...args, message: `Model not found: ${args.selector}` });
  }
}

/** Returned when a provider-less or variant-less selector matches multiple models. */
export class ModelSelectorAmbiguousError extends TaggedError("ModelSelectorAmbiguousError")<{
  readonly selector: string;
  readonly matchingSelectors: readonly string[];
  readonly message: string;
}>() {
  constructor(args: { readonly selector: string; readonly matchingSelectors: readonly string[] }) {
    super({ ...args, message: `Model selector is ambiguous: ${args.selector}` });
  }
}

/** Returned when the `/model` response cannot be sent back to chat. */
export class ModelCommandResponseError extends TaggedError("ModelCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send /model response: ${describeCause(args.cause)}` });
  }
}
