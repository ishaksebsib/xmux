import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../../components";
import {
  FileSystemAccessError,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
} from "../../../filesystem";
import type { ThreadWorkspace } from "../../../store";
import type { ChangeDirectoryForThreadError } from "./service";

export function formatCdSuccess(workspace: ThreadWorkspace): ChatTextInput {
  return markdown({
    text: ["**Directory changed**", "", `Current directory: ${inlineCode(workspace.cwd)}`].join(
      "\n",
    ),
  });
}

export function formatCdFailure(error: ChangeDirectoryForThreadError): ChatTextInput {
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
    text: ["**Error:** Failed to change directory", "", markdownText(error.message)].join("\n"),
  });
}

export function formatCdCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/cd",
    summary: "change current directory",
    description: "Set the workspace directory for future commands in this chat thread.",
    usage: "/cd <path>",
    examples: ["/cd packages/orchestrator", "/cd .."],
  });
}
