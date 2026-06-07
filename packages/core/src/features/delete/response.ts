import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { formatSessionSelectionList } from "../shared/session-selection";
import { CommandHarnessNotConfiguredError } from "../errors";
import {
  DeleteCommandIncompleteTargetError,
  DeleteSessionListAllFailedError,
  DeleteSessionShortIdAmbiguousError,
  DeleteSessionShortIdNotFoundError,
} from "./errors";
import type { DeleteCommandError, DeleteCommandOutput, DeleteListOutput } from "./service";

export function formatDeleteOutput(output: DeleteCommandOutput): ChatTextInput {
  return output.status === "listed" ? formatDeleteList(output) : formatDeleteSuccess(output);
}

export function formatDeleteList(output: DeleteListOutput): ChatTextInput {
  return formatSessionSelectionList({
    commandName: "delete",
    cwd: output.cwd,
    groups: output.groups,
    failures: output.failures,
    emptyDescription: "No configured harness reported deletable sessions for this directory.",
  });
}

export function formatDeleteFailure(error: DeleteCommandError): ChatTextInput {
  if (DeleteCommandIncompleteTargetError.is(error)) {
    return markdown({
      text: [
        "**Incomplete delete command**",
        "",
        "- Use `/delete` to delete the active session or list sessions.",
        "- Then use `/delete <harnessId> <shortId>` to delete a listed session.",
      ].join("\n"),
    });
  }

  if (CommandHarnessNotConfiguredError.is(error)) {
    const available =
      error.availableHarnessIds.length > 0
        ? error.availableHarnessIds.map(inlineCode).join("\n- ")
        : "none";

    return markdown({
      text: [
        `**Error:** Unknown harness ${inlineCode(error.harnessId)}`,
        "",
        "Available harnesses",
        `- ${available}`,
      ].join("\n"),
    });
  }

  if (DeleteSessionShortIdNotFoundError.is(error)) {
    return markdown({
      text: [
        "**Session not found**",
        "",
        `- Harness: ${inlineCode(error.harnessId)}`,
        `- Short ID: ${inlineCode(error.shortId)}`,
        `- Directory: ${inlineCode(error.cwd)}`,
        "",
        `Run ${inlineCode("/delete")} to see deletable sessions.`,
      ].join("\n"),
    });
  }

  if (DeleteSessionShortIdAmbiguousError.is(error)) {
    return markdown({
      text: [
        "**Short ID is ambiguous**",
        "",
        `- Harness: ${inlineCode(error.harnessId)}`,
        `- Short ID: ${inlineCode(error.shortId)}`,
        "",
        "Matching sessions:",
        error.matchingSessionIds.map((sessionId) => `- ${inlineCode(sessionId)}`).join("\n"),
        "",
        `Run ${inlineCode("/delete")} again and use the displayed short ID.`,
      ].join("\n"),
    });
  }

  if (DeleteSessionListAllFailedError.is(error)) {
    return markdown({
      text: [
        `**Failed to list sessions** (${error.failures.length})`,
        "",
        ...error.failures.map(
          (failure) =>
            `- ${inlineCode(failure.harnessId)} — ${markdownText(failure.error.message)}`,
        ),
      ].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to delete session**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatDeleteCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/delete",
    summary: "delete active or selected session",
    description:
      "Delete the active session, or show deletable sessions in the current workspace and delete one by short id.",
    usage: "/delete [harnessId shortId]",
    examples: ["/delete", "/delete opencode abc", "/delete pi def9"],
  });
}

function formatDeleteSuccess(
  output: Extract<DeleteCommandOutput, { readonly status: "deleted" }>,
): ChatTextInput {
  const lines = [
    `**Deleted** ${inlineCode(`${output.session.ref.harnessId}/${output.session.shortId}`)}`,
    "",
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Short ID: ${inlineCode(output.session.shortId)}`,
  ];

  if (output.session.title) {
    lines.push(`- Title: ${markdownText(output.session.title)}`);
  }

  if (output.session.cwd) {
    lines.push(`- Directory: ${inlineCode(output.session.cwd)}`);
  }

  return markdown({ text: lines.join("\n") });
}
