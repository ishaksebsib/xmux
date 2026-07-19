import { TaggedError } from "better-result";
import type { StoreOperation } from "./store";
import type { XmuxCloseCause } from "./xmux";
import { describeCause } from "./utils";

export class XmuxConfigurationError extends TaggedError("XmuxConfigurationError")<{
  readonly path: string;
  readonly reason: string;
  readonly message: string;
}>() {
  constructor(args: { readonly path: string; readonly reason: string }) {
    super({
      ...args,
      message: `Invalid xmux configuration at ${args.path}: ${args.reason}`,
    });
  }
}

export class XmuxInitializeError extends TaggedError("XmuxInitializeError")<{
  readonly cause: unknown;
  readonly rollbackCause?: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown; readonly rollbackCause?: unknown }) {
    const rollbackDetail =
      args.rollbackCause === undefined
        ? ""
        : `; store rollback failed: ${describeCause(args.rollbackCause)}`;
    super({
      ...args,
      message: `Failed to initialize xmux: ${describeCause(args.cause)}${rollbackDetail}`,
    });
  }
}

export class XmuxCloseError extends TaggedError("XmuxCloseError")<{
  readonly cause: XmuxCloseCause;
  readonly message: string;
}>() {
  constructor(cause: XmuxCloseCause) {
    const parts = [] as string[];

    if (cause.harness !== undefined) {
      parts.push(`Failed to shut down harness runtime: ${describeCause(cause.harness)}`);
    }

    if (cause.chat !== undefined) {
      parts.push(`Failed to shut down chat runtime: ${describeCause(cause.chat)}`);
    }

    if (cause.store !== undefined) {
      parts.push(`Failed to close store: ${describeCause(cause.store)}`);
    }

    if (cause.runtime !== undefined) {
      parts.push(`Failed to tear down xmux runtime: ${describeCause(cause.runtime)}`);
    }

    super({
      cause,
      message: parts.join("; ") || "Failed to close xmux runtime",
    });
  }
}

// -----------------------------------------------------------------------------
// Middleware errors
// -----------------------------------------------------------------------------

/** Returned when middleware calls `next()` more than once in one request. */
export class XmuxMiddlewareNextAlreadyCalledError extends TaggedError(
  "XmuxMiddlewareNextAlreadyCalledError",
)<{
  readonly routeName: string;
  readonly message: string;
}>() {
  constructor(args: { readonly routeName: string }) {
    super({
      ...args,
      message: `Xmux middleware called next() multiple times while handling ${args.routeName}`,
    });
  }
}

/** Wraps unexpected throws from middleware or the terminal route handler. */
export class XmuxMiddlewareExecutionError extends TaggedError("XmuxMiddlewareExecutionError")<{
  readonly routeName: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly routeName: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Xmux middleware failed while handling ${args.routeName}: ${describeCause(args.cause)}`,
    });
  }
}

export type XmuxMiddlewareError =
  | XmuxMiddlewareNextAlreadyCalledError
  | XmuxMiddlewareExecutionError;

// -----------------------------------------------------------------------------
// Store errors
// -----------------------------------------------------------------------------

/** Wraps failures while opening or migrating a store backend. */
export class StoreInitializationError extends TaggedError("StoreInitializationError")<{
  readonly backend: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly backend: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to initialize ${args.backend} store: ${describeCause(args.cause)}`,
    });
  }
}

/** Wraps failures while releasing a store backend. */
export class StoreCloseError extends TaggedError("StoreCloseError")<{
  readonly backend: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly backend: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to close ${args.backend} store: ${describeCause(args.cause)}`,
    });
  }
}

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
    const detail = describeCause(args.cause);

    super({
      ...args,
      message: `Failed to ${args.operation} ${args.resource}: ${detail}`,
    });
  }
}

export type StoreLifecycleError = StoreInitializationError | StoreCloseError;
export type StoreError = StoreConflictError | StoreNotFoundError | StoreOperationError;
