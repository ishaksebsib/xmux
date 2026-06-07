import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { CommandHarnessNotConfiguredError } from "../errors";
import { formatSessionCommandFailure } from "../shared/session-command";
import { formatSessionSelectionList } from "../shared/session-selection";
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
  const shared = formatSessionCommandFailure(error, "resume", "list sessions", "to see available sessions");

  if (shared) return shared;

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
