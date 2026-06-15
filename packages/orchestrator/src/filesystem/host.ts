import type { Result } from "better-result";
import type {
  FileSystemAccessError,
  FileSystemOperation,
  FileSystemPathNotFoundError,
} from "./errors";

export type FileSystemEntryType = "directory" | "file" | "other";

export interface FileSystemStat {
  readonly type: FileSystemEntryType;
}

export interface FileSystemDirectoryEntry {
  readonly name: string;
  readonly type: FileSystemEntryType;
}

export type FileSystemHostError = FileSystemAccessError | FileSystemPathNotFoundError;

/** Injectable filesystem boundary used by workspace features. */
export interface FileSystemHost {
  resolvePath(input: ResolvePathInput): string;
  realpath(input: FileSystemPathInput): Promise<Result<string, FileSystemHostError>>;
  stat(input: FileSystemPathInput): Promise<Result<FileSystemStat, FileSystemHostError>>;
  readdir(
    input: FileSystemPathInput,
  ): Promise<Result<readonly FileSystemDirectoryEntry[], FileSystemHostError>>;
}

export interface ResolvePathInput {
  readonly baseCwd: string;
  readonly inputPath: string;
}

export interface FileSystemPathInput {
  readonly path: string;
}

export type { FileSystemOperation };
