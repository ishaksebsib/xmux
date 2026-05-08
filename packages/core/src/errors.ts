import { TaggedError } from "better-result";
import type { XmuxCloseCause } from "./contracts";
import type { StoreOperation } from "./store";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class XmuxInitializeError extends TaggedError("XmuxInitializeError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { cause: unknown }) {
    super({
      ...args,
      message: `Failed to initialize xmux: ${describeCause(args.cause)}`,
    });
  }
}

export class XmuxCloseError extends TaggedError("XmuxCloseError")<{
  readonly cause: XmuxCloseCause;
  readonly message: string;
}>() {
  constructor(cause: XmuxCloseCause) {
    const parts = [] as string[];

    if (cause.harness) {
      parts.push(cause.harness.message);
    }

    if (cause.chat !== undefined) {
      parts.push(`Failed to shut down chat runtime: ${describeCause(cause.chat)}`);
    }

    super({
      cause,
      message: parts.join("; ") || "Failed to close xmux runtime",
    });
  }
}

// -----------------------------------------------------------------------------
// Store errors
// -----------------------------------------------------------------------------

/** Returned when a create operation would overwrite an existing record. */
export class StoreConflictError extends TaggedError("StoreConflictError")<{
  readonly resource: string;
  readonly id: string;
  readonly message: string;
}>() {
  constructor(args: { readonly resource: string; readonly id: string }) {
    super({
      ...args,
      message: `${args.resource} already exists: ${args.id}`,
    });
  }
}

/** Returned when an update operation targets a missing record. */
export class StoreNotFoundError extends TaggedError("StoreNotFoundError")<{
  readonly resource: string;
  readonly id: string;
  readonly message: string;
}>() {
  constructor(args: { readonly resource: string; readonly id: string }) {
    super({
      ...args,
      message: `${args.resource} not found: ${args.id}`,
    });
  }
}

/** Wraps unexpected backend failures from a store implementation. */
export class StoreOperationError extends TaggedError("StoreOperationError")<{
  readonly operation: StoreOperation;
  readonly resource: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly operation: StoreOperation;
    readonly resource: string;
    readonly cause: unknown;
  }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);

    super({
      ...args,
      message: `Failed to ${args.operation} ${args.resource}: ${detail}`,
    });
  }
}

export type StoreError = StoreConflictError | StoreNotFoundError | StoreOperationError;
