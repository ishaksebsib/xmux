import { TaggedError } from "better-result";

export class SqliteMigrationError extends TaggedError("SqliteMigrationError")<{
  readonly path: string;
  readonly migration: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly path: string;
    readonly migration: string;
    readonly cause: unknown;
  }) {
    super({
      ...args,
      message: `Failed to apply SQLite migration ${args.migration} for ${args.path}`,
    });
  }
}

export class SqliteMigrationClientError extends TaggedError("SqliteMigrationClientError")<{
  readonly path: string;
  readonly operation: "open" | "close";
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly path: string;
    readonly operation: "open" | "close";
    readonly cause: unknown;
  }) {
    super({
      ...args,
      message: `Failed to ${args.operation} SQLite migration client for ${args.path}`,
    });
  }
}

export class SqliteSchemaCompatibilityError extends TaggedError("SqliteSchemaCompatibilityError")<{
  readonly resource: string;
  readonly reason: string;
  readonly message: string;
}>() {
  constructor(args: { readonly resource: string; readonly reason: string }) {
    super({
      ...args,
      message: `Incompatible existing SQLite ${args.resource}: ${args.reason}`,
    });
  }
}

export class SqliteRowDecodeError extends TaggedError("SqliteRowDecodeError")<{
  readonly column: string;
  readonly expected: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly column: string;
    readonly expected: string;
    readonly cause: unknown;
  }) {
    super({
      ...args,
      message: `Invalid persisted column ${args.column}: expected ${args.expected}`,
    });
  }
}

export class SqliteConfigurationError extends TaggedError("SqliteConfigurationError")<{
  readonly field: string;
  readonly reason: string;
  readonly message: string;
}>() {
  constructor(args: { readonly field: string; readonly reason: string }) {
    super({ ...args, message: `Invalid SQLite option ${args.field}: ${args.reason}` });
  }
}

export class SqliteResultShapeError extends TaggedError("SqliteResultShapeError")<{
  readonly expected: string;
  readonly actual: number;
  readonly message: string;
}>() {
  constructor(args: { readonly expected: string; readonly actual: number }) {
    super({
      ...args,
      message: `Unexpected SQLite row count: expected ${args.expected}, got ${args.actual}`,
    });
  }
}

export class SqliteStoreStateError extends TaggedError("SqliteStoreStateError")<{
  readonly state: string;
  readonly message: string;
}>() {
  constructor(state: string) {
    super({ state, message: `SQLite store is not ready (state: ${state})` });
  }
}
