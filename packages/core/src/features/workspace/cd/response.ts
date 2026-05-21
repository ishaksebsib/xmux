import {
  FileSystemAccessError,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
} from "../../../filesystem";
import type { ThreadWorkspace } from "../../../store";
import type { ChangeDirectoryForThreadError } from "./service";

export function formatCdSuccess(workspace: ThreadWorkspace): string {
  return `Changed directory to ${workspace.cwd}`;
}

export function formatCdFailure(error: ChangeDirectoryForThreadError): string {
  if (FileSystemPathNotFoundError.is(error)) {
    return `Path not found: ${error.path}`;
  }

  if (InvalidDirectoryError.is(error)) {
    return `Not a directory: ${error.path}`;
  }

  if (FileSystemAccessError.is(error)) {
    return `Filesystem access error: ${error.message}`;
  }

  return `Failed to change directory: ${error.message}`;
}

export function formatCdCommandUsage(): string {
  return "Usage: /cd <path>";
}
