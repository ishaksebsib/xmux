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

export type StoreError = StoreConflictError | StoreNotFoundError | StoreOperationError;
