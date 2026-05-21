import { TaggedError } from "better-result";

export type FileSystemOperation = "realpath" | "stat" | "readdir";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Returned when a filesystem path does not exist. */
export class FileSystemPathNotFoundError extends TaggedError("FileSystemPathNotFoundError")<{
  readonly path: string;
  readonly operation: FileSystemOperation;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly path: string;
    readonly operation: FileSystemOperation;
    readonly cause: unknown;
  }) {
    super({
      ...args,
      message: `Path not found: ${args.path}`,
    });
  }
}

/** Returned when the runtime cannot access the filesystem path. */
export class FileSystemAccessError extends TaggedError("FileSystemAccessError")<{
  readonly path: string;
  readonly operation: FileSystemOperation;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: {
    readonly path: string;
    readonly operation: FileSystemOperation;
    readonly cause: unknown;
  }) {
    super({
      ...args,
      message: `Failed to ${args.operation} ${args.path}: ${describeCause(args.cause)}`,
    });
  }
}

/** Returned when a path exists but cannot be used as a directory. */
export class InvalidDirectoryError extends TaggedError("InvalidDirectoryError")<{
  readonly path: string;
  readonly reason: "not_directory";
  readonly message: string;
}>() {
  constructor(args: { readonly path: string; readonly reason: "not_directory" }) {
    super({
      ...args,
      message: `Not a directory: ${args.path}`,
    });
  }
}

export type FileSystemError =
  | FileSystemAccessError
  | FileSystemPathNotFoundError
  | InvalidDirectoryError;
