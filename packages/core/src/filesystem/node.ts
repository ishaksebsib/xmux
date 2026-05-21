import { readdir, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Result } from "better-result";
import type {
  FileSystemDirectoryEntry,
  FileSystemEntryType,
  FileSystemHost,
  FileSystemHostError,
  FileSystemOperation,
  FileSystemStat,
} from "./host";
import { FileSystemAccessError, FileSystemPathNotFoundError } from "./errors";

/** Creates the production filesystem host backed by Node filesystem APIs. */
export function createNodeFileSystemHost(): FileSystemHost {
  return {
    resolvePath(input) {
      return resolve(input.baseCwd, input.inputPath);
    },

    async realpath(input) {
      return Result.tryPromise({
        try: () => realpath(input.path),
        catch: (cause) => toFileSystemHostError({ operation: "realpath", path: input.path, cause }),
      });
    },

    async stat(input) {
      const result = await Result.tryPromise({
        try: () => stat(input.path),
        catch: (cause) => toFileSystemHostError({ operation: "stat", path: input.path, cause }),
      });

      return result.isOk() ? Result.ok(toFileSystemStat(result.value)) : Result.err(result.error);
    },

    async readdir(input) {
      const result = await Result.tryPromise({
        try: () => readdir(input.path, { withFileTypes: true }),
        catch: (cause) => toFileSystemHostError({ operation: "readdir", path: input.path, cause }),
      });

      return result.isOk()
        ? Result.ok(result.value.map((entry) => ({ name: entry.name, type: entryType(entry) })))
        : Result.err(result.error);
    },
  };
}

function toFileSystemStat(stats: FileSystemStatLike): FileSystemStat {
  return {
    type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
  };
}

function entryType(entry: FileSystemStatLike): FileSystemEntryType {
  return entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
}

interface FileSystemStatLike {
  isDirectory(): boolean;
  isFile(): boolean;
}

function toFileSystemHostError(input: {
  readonly operation: FileSystemOperation;
  readonly path: string;
  readonly cause: unknown;
}): FileSystemHostError {
  return hasNodeErrorCode({ cause: input.cause, code: "ENOENT" })
    ? new FileSystemPathNotFoundError(input)
    : new FileSystemAccessError(input);
}

function hasNodeErrorCode(input: { readonly cause: unknown; readonly code: string }): boolean {
  return (
    typeof input.cause === "object" &&
    input.cause !== null &&
    "code" in input.cause &&
    input.cause.code === input.code
  );
}
