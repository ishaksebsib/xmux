import {
  FileSystemAccessError,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
  type FileSystemDirectoryEntry,
} from "../../../filesystem";
import type { ListDirectoryForThreadError, ListDirectoryForThreadOutput } from "./service";

export function formatLsSuccess(output: ListDirectoryForThreadOutput): string {
  const body = output.entries.length === 0
    ? "(empty)"
    : output.entries.map(formatDirectoryEntry).join("\n");
  const truncation = output.truncated
    ? `\n\nShowing ${output.entries.length} of ${output.totalEntryCount} entries.`
    : "";

  return `${output.cwd}\n\n${body}${truncation}`;
}

export function formatLsFailure(error: ListDirectoryForThreadError): string {
  if (FileSystemPathNotFoundError.is(error)) {
    return `Path not found: ${error.path}`;
  }

  if (InvalidDirectoryError.is(error)) {
    return `Not a directory: ${error.path}`;
  }

  if (FileSystemAccessError.is(error)) {
    return `Filesystem access error: ${error.message}`;
  }

  return `Failed to list directory: ${error.message}`;
}

export function formatLsCommandUsage(): string {
  return "Usage: /ls [path]";
}

function formatDirectoryEntry(entry: FileSystemDirectoryEntry): string {
  const icon = entry.type === "directory" ? "📁" : entry.type === "file" ? "📄" : "•";
  return `${icon} ${entry.name}`;
}
