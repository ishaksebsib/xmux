import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown, markdownText } from "../../../components";
import type {
  ListedSelectableSession,
  SessionSelectionGroup,
  SessionSelectionListFailure,
} from "./service";

const MAX_SESSION_SELECTION_LIST_TEXT_LENGTH = 3200;

export interface FormatSessionSelectionListInput {
  readonly cwd: string;
  readonly groups: readonly SessionSelectionGroup[];
  readonly failures: readonly SessionSelectionListFailure[];
  readonly commandName: "resume" | "delete";
  readonly emptyDescription: string;
}

export function formatSessionSelectionList(input: FormatSessionSelectionListInput): ChatTextInput {
  const total = input.groups.reduce((count, group) => count + group.totalSessionCount, 0);

  if (total === 0) {
    return markdown({
      text: [
        "**No sessions found**",
        "",
        `Current directory: ${inlineCode(input.cwd)}`,
        "",
        input.emptyDescription,
        formatSelectionListFailures(input.failures),
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    });
  }

  const failures = formatSelectionListFailures(input.failures);
  const commandUsage = `/${input.commandName} <harnessId> <shortId>`;
  const header = [
    `**Available sessions** (${total})`,
    "",
    `Current directory: ${inlineCode(input.cwd)}`,
    "",
    `Use ${inlineCode(commandUsage)} to ${selectionVerb(input.commandName)} one.`,
    "",
  ].join("\n");
  const groups = formatSessionSelectionGroups({
    groups: input.groups.filter(hasSessions),
    commandName: input.commandName,
    maxLength: Math.max(
      0,
      MAX_SESSION_SELECTION_LIST_TEXT_LENGTH - header.length - failures.length,
    ),
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

function formatSessionSelectionGroups(input: {
  readonly groups: readonly SessionSelectionGroup[];
  readonly commandName: "resume" | "delete";
  readonly maxLength: number;
  readonly total: number;
}): { readonly text: string; readonly omitted: number } {
  const renderedGroups = [] as string[];
  let shown = 0;

  for (const group of input.groups) {
    const header = formatSessionSelectionGroupHeader(group);
    const sessionBlocks = [] as string[];

    for (const session of group.sessions) {
      const sessionBlock = formatSelectableSession({
        session,
        commandName: input.commandName,
      });
      const candidateGroup = formatSessionSelectionGroupText({
        header,
        sessionBlocks: [...sessionBlocks, sessionBlock],
      });
      const candidateText = [...renderedGroups, candidateGroup].join("\n\n");

      if (candidateText.length > input.maxLength) {
        break;
      }

      sessionBlocks.push(sessionBlock);
      shown += 1;
    }

    if (sessionBlocks.length > 0) {
      renderedGroups.push(formatSessionSelectionGroupText({ header, sessionBlocks }));
    }
  }

  return {
    text: renderedGroups.join("\n\n"),
    omitted: Math.max(0, input.total - shown),
  };
}

function formatSessionSelectionGroupHeader(group: SessionSelectionGroup): string {
  const harnessId = markdownText(group.harnessId);

  if (group.totalSessionCount === group.sessions.length) {
    return `> **${harnessId}** (${group.totalSessionCount})`;
  }

  return `> **${harnessId}** (showing ${group.sessions.length} of ${group.totalSessionCount})`;
}

function formatSessionSelectionGroupText(input: {
  readonly header: string;
  readonly sessionBlocks: readonly string[];
}): string {
  return [input.header, "", input.sessionBlocks.join("\n\n")].join("\n");
}

function formatSelectableSession(input: {
  readonly session: ListedSelectableSession;
  readonly commandName: "resume" | "delete";
}): string {
  const title = input.session.title?.trim() || "Untitled session";
  return [
    `- Title: ${markdownText(title)}`,
    `  Short ID: ${inlineCode(input.session.shortId)}`,
    `  Command: ${inlineCode(
      `/${input.commandName} ${input.session.harnessId} ${input.session.shortId}`,
    )}`,
  ].join("\n");
}

function formatSelectionListFailures(failures: readonly SessionSelectionListFailure[]): string {
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

function selectionVerb(commandName: "resume" | "delete"): string {
  return commandName === "resume" ? "activate" : "delete";
}

function hasSessions(group: SessionSelectionGroup): boolean {
  return group.sessions.length > 0;
}
