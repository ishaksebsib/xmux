import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import {
  ResumeCommandHarnessNotConfiguredError,
  ResumeCommandIncompleteTargetError,
  ResumeSessionListAllFailedError,
  ResumeSessionShortIdAmbiguousError,
  ResumeSessionShortIdNotFoundError,
  type ResumeSessionListFailure,
} from "./errors";
import type {
  ListedResumeSession,
  ResumeCommandError,
  ResumeCommandOutput,
  ResumeListOutput,
  ResumeSessionGroup,
} from "./service";

export function formatResumeOutput(output: ResumeCommandOutput): ChatTextInput {
  return output.status === "listed" ? formatResumeList(output) : formatResumeSuccess(output);
}

export function formatResumeList(output: ResumeListOutput): ChatTextInput {
  const total = output.groups.reduce((count, group) => count + group.sessions.length, 0);

  if (total === 0) {
    return markdown({
      text: [
        "**No sessions found**",
        "",
        `Current directory: ${inlineCode(output.cwd)}`,
        "",
        "No configured harness reported resumable sessions for this directory.",
        formatListFailures(output.failures),
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    });
  }

  return markdown({
    text: [
      "**Available sessions**",
      "",
      `Current directory: ${inlineCode(output.cwd)}`,
      "",
      output.groups.filter(hasSessions).map(formatResumeGroup).join("\n\n"),
      "",
      `Use ${inlineCode("/resume <harnessId> <shortId>")} to activate one.`,
      formatListFailures(output.failures),
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  });
}

export function formatResumeFailure(error: ResumeCommandError): ChatTextInput {
  if (ResumeCommandIncompleteTargetError.is(error)) {
    return markdown({
      text: [
        "**Incomplete resume command**",
        "",
        `Use ${inlineCode("/resume")} to list sessions, then ${inlineCode(
          "/resume <harnessId> <shortId>",
        )} to activate one.`,
      ].join("\n"),
    });
  }

  if (ResumeCommandHarnessNotConfiguredError.is(error)) {
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
        `Harness: ${inlineCode(error.harnessId)}`,
        `Short ID: ${inlineCode(error.shortId)}`,
        `Current directory: ${inlineCode(error.cwd)}`,
        "",
        `Run ${inlineCode("/resume")} to refresh available sessions.`,
      ].join("\n"),
    });
  }

  if (ResumeSessionShortIdAmbiguousError.is(error)) {
    return markdown({
      text: [
        "**Short ID is ambiguous**",
        "",
        `Harness: ${inlineCode(error.harnessId)}`,
        `Short ID: ${inlineCode(error.shortId)}`,
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
        "**Failed to list sessions**",
        "",
        ...error.failures.map(
          (failure) => `- ${inlineCode(failure.harnessId)}: ${markdownText(failure.error.message)}`,
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
    "**Session resumed**",
    "",
    `Harness: ${inlineCode(output.session.ref.harnessId)}`,
    `Short ID: ${inlineCode(output.shortId)}`,
  ];

  if (output.session.title) {
    lines.push(`Title: ${markdownText(output.session.title)}`);
  }

  lines.push(`Current directory: ${inlineCode(output.session.cwd)}`);
  lines.push("");
  lines.push("The session is now active. Send a message to continue.");

  return markdown({ text: lines.join("\n") });
}

function formatResumeGroup(group: ResumeSessionGroup): string {
  return [`**${markdownText(group.harnessId)}**`, ...group.sessions.map(formatResumeSession)].join(
    "\n",
  );
}

function formatResumeSession(session: ListedResumeSession): string {
  const title = session.title?.trim() || "Untitled session";
  return `- ${inlineCode(`/resume ${session.harnessId} ${session.shortId}`)} — ${markdownText(title)}`;
}

function formatListFailures(failures: readonly ResumeSessionListFailure[]): string {
  if (failures.length === 0) {
    return "";
  }

  return [
    "",
    "Some harnesses could not be listed:",
    ...failures.map(
      (failure) => `- ${inlineCode(failure.harnessId)}: ${markdownText(failure.error.message)}`,
    ),
  ].join("\n");
}

function hasSessions(group: ResumeSessionGroup): boolean {
  return group.sessions.length > 0;
}
