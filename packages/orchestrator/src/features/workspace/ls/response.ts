import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../../components";
import {
  FileSystemAccessError,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
  type FileSystemDirectoryEntry,
} from "../../../filesystem";
import type { ListDirectoryForThreadError, ListDirectoryForThreadOutput } from "./service";

export function formatLsSuccess(output: ListDirectoryForThreadOutput): ChatTextInput {
  const body =
    output.entries.length === 0
      ? "_Empty directory._"
      : output.entries.map(formatDirectoryEntry).join("\n");
  const truncation = output.truncated
    ? `\n\n_Showing ${output.entries.length} of ${output.totalEntryCount} entries._`
    : "";

  return markdown({
    text: [
      "**Directory listing**",
      "",
      `Path: ${inlineCode(output.cwd)}`,
      "",
      `${body}${truncation}`,
    ].join("\n"),
  });
}

export function formatLsFailure(error: ListDirectoryForThreadError): ChatTextInput {
  if (FileSystemPathNotFoundError.is(error)) {
    return markdown({ text: ["**Error:** Path not found", "", inlineCode(error.path)].join("\n") });
  }

  if (InvalidDirectoryError.is(error)) {
    return markdown({
      text: ["**Error:** Not a directory", "", inlineCode(error.path)].join("\n"),
    });
  }

  if (FileSystemAccessError.is(error)) {
    return markdown({
      text: ["**Error:** Filesystem access failed", "", markdownText(error.message)].join("\n"),
    });
  }

  return markdown({
    text: ["**Error:** Failed to list directory", "", markdownText(error.message)].join("\n"),
  });
}

export function formatLsCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/ls",
    summary: "list directory entries",
    description: "Show files and directories in the current workspace or a relative path.",
    usage: "/ls [path]",
    examples: ["/ls", "/ls packages/orchestrator"],
  });
}

function formatDirectoryEntry(entry: FileSystemDirectoryEntry): string {
  const icon = entry.type === "directory" ? "📁" : entry.type === "file" ? "📄" : "•";
  const name = entry.type === "directory" ? `${entry.name}/` : entry.name;

  return `- ${icon} ${inlineCode(name)}`;
}
