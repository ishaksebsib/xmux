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

const MAX_RESUME_LIST_TEXT_LENGTH = 3200;

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

  const failures = formatListFailures(output.failures);
  const header = [
    `**Available sessions** (${total})`,
    "",
    `Current directory: ${inlineCode(output.cwd)}`,
    "",
    `Use ${inlineCode("/resume <harnessId> <shortId>")} to activate one.`,
    "",
  ].join("\n");
  const groups = formatResumeGroups({
    groups: output.groups.filter(hasSessions),
    maxLength: Math.max(0, MAX_RESUME_LIST_TEXT_LENGTH - header.length - failures.length),
    total,
  });

  return markdown({
    text: [
      header,
      groups.text,
      groups.omitted > 0 ? `_And ${groups.omitted} more sessions._` : "",
      failures,
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
        "- Use `/resume` to list sessions.",
        "- Then use `/resume <harnessId> <shortId>` to activate one.",
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

  return markdown({ text: lines.join("\n") });
}

function formatResumeGroups(input: {
  readonly groups: readonly ResumeSessionGroup[];
  readonly maxLength: number;
  readonly total: number;
}): { readonly text: string; readonly omitted: number } {
  const renderedGroups = [] as string[];
  let shown = 0;

  for (const group of input.groups) {
    const lines = [`**${markdownText(group.harnessId)}** (${group.sessions.length})`];

    for (const session of group.sessions) {
      const sessionLine = formatResumeSession(session);
      const candidateGroup = [...lines, sessionLine].join("\n");
      const candidateText = [...renderedGroups, candidateGroup].join("\n\n");

      if (candidateText.length > input.maxLength) {
        break;
      }

      lines.push(sessionLine);
      shown += 1;
    }

    if (lines.length > 1) {
      renderedGroups.push(lines.join("\n"));
    }
  }

  return {
    text: renderedGroups.join("\n\n"),
    omitted: Math.max(0, input.total - shown),
  };
}

function formatResumeSession(session: ListedResumeSession): string {
  const title = session.title?.trim() || "Untitled session";
  return [
    `- Short ID: ${inlineCode(session.shortId)}`,
    `  Title: ${markdownText(title)}`,
    `  Command: ${inlineCode(`/resume ${session.harnessId} ${session.shortId}`)}`,
  ].join("\n");
}

function formatListFailures(failures: readonly ResumeSessionListFailure[]): string {
  if (failures.length === 0) {
    return "";
  }

  return [
    "",
    "Some harnesses could not be listed:",
    ...failures.map(
      (failure) => `- ${inlineCode(failure.harnessId)} — ${markdownText(failure.error.message)}`,
    ),
  ].join("\n");
}

function hasSessions(group: ResumeSessionGroup): boolean {
  return group.sessions.length > 0;
}
