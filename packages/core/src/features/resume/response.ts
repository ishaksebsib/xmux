import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { formatSessionSelectionList } from "../shared/session-selection";
import { CommandHarnessNotConfiguredError } from "../errors";
import {
  ResumeCommandIncompleteTargetError,
  ResumeSessionListAllFailedError,
  ResumeSessionShortIdAmbiguousError,
  ResumeSessionShortIdNotFoundError,
} from "./errors";
import type { ResumeCommandError, ResumeCommandOutput, ResumeListOutput } from "./service";

export function formatResumeOutput(output: ResumeCommandOutput): ChatTextInput {
  return output.status === "listed" ? formatResumeList(output) : formatResumeSuccess(output);
}

export function formatResumeList(output: ResumeListOutput): ChatTextInput {
  return formatSessionSelectionList({
    commandName: "resume",
    cwd: output.cwd,
    groups: output.groups,
    failures: output.failures,
    emptyDescription: "No configured harness reported resumable sessions for this directory.",
  });
}

export function formatResumeFailure(error: ResumeCommandError): ChatTextInput {
  if (ResumeCommandIncompleteTargetError.is(error)) {
    return markdown({
      text: [
        "**Incomplete resume command**",
        "",
        "- Use `/resume` to list sessions.",
        "- Then use `/resume <harnessId> <shortId>` to activate one.",
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

  if (ResumeSessionShortIdNotFoundError.is(error)) {
    return markdown({
      text: [
        "**Session not found**",
        "",
        `- Harness: ${inlineCode(error.harnessId)}`,
        `- Short ID: ${inlineCode(error.shortId)}`,
        `- Directory: ${inlineCode(error.cwd)}`,
        "",
        `Run ${inlineCode("/resume")} to see available sessions.`,
      ].join("\n"),
    });
  }

  if (ResumeSessionShortIdAmbiguousError.is(error)) {
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
        `Run ${inlineCode("/resume")} again and use the displayed short ID.`,
      ].join("\n"),
    });
  }

  if (ResumeSessionListAllFailedError.is(error)) {
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
    text: ["**Failed to resume session**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatResumeCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/resume",
    summary: "list or resume existing sessions",
    description:
      "Show resumable sessions in the current workspace, or activate one by harness and short id.",
    usage: "/resume [harnessId shortId]",
    examples: ["/resume", "/resume opencode abc", "/resume pi def9"],
  });
}

function formatResumeSuccess(
  output: Extract<ResumeCommandOutput, { readonly status: "resumed" }>,
): ChatTextInput {
  const lines = [
    `**Resumed** ${inlineCode(`${output.session.ref.harnessId}/${output.shortId}`)}`,
    "",
    `- Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `- Short ID: ${inlineCode(output.shortId)}`,
  ];

  if (output.session.title) {
    lines.push(`- Title: ${markdownText(output.session.title)}`);
  }

  lines.push(`- Directory: ${inlineCode(output.session.cwd)}`);
  lines.push("");
  lines.push("Send a message to continue the conversation.");

  return markdown({ text: lines.join("\n") });
}
