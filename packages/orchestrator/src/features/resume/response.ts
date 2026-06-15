import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import { resumeHarnessActionId, resumeSessionActionId, type Actions } from "../../actions";
import {
  formatCommandHelp,
  formatHarnessNotConfigured,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import { CommandHarnessNotConfiguredError } from "../errors";
import { formatActionButtonRows } from "../button-layout";
import {
  formatHarnessChoice,
  harnessSelectionMessage,
  type HarnessChoicePrompt,
} from "../shared/harness-selection";
import { formatSessionCommandFailure } from "../shared/session-command";
import { normalizeTextInput, type ActionMessage } from "../utils";
import type {
  ResumeCommandError,
  ResumeCommandOutput,
  ResumeHarnessesOutput,
  ResumeListOutput,
} from "./service";

export type ResumeActionMessage = ActionMessage;

export function formatResumeOutput(output: ResumeCommandOutput): ChatTextInput {
  if (output.status === "harnesses") return formatResumeHarnesses(output);
  if (output.status === "listed") return formatResumeList(output);
  return formatResumeSuccess(output);
}

export function formatResumeList(output: ResumeListOutput): ChatTextInput {
  const title = output.group.harnessId;

  if (output.group.totalSessionCount === 0) {
    return markdown({
      text: [
        `**${title} sessions**`,
        "",
        `Current directory: ${inlineCode(output.cwd)}`,
        "",
        "No sessions found.",
      ].join("\n"),
    });
  }

  const lines = [
    `**${title} sessions** (${output.group.totalSessionCount})`,
    "",
    `Current directory: ${inlineCode(output.cwd)}`,
    "",
    `Use ${inlineCode(`/resume ${output.group.harnessId} <shortId>`)} or press Resume.`,
    "",
  ];

  for (const session of output.group.sessions) {
    const title = session.title?.trim() || "Untitled session";
    lines.push(
      [
        `- Title: ${markdownText(title)}`,
        `  Short ID: ${inlineCode(session.shortId)}`,
        `  Command: ${inlineCode(`/resume ${session.harnessId} ${session.shortId}`)}`,
      ].join("\n"),
    );
    lines.push("");
  }

  const remaining = output.group.totalSessionCount - output.group.sessions.length;
  if (remaining > 0) {
    lines.push(`_And ${remaining} more sessions._`);
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return markdown({ text: lines.join("\n") });
}

export function formatResumeHarnessActionMessage(
  output: ResumeHarnessesOutput,
): ResumeActionMessage {
  return harnessSelectionMessage({
    prompt: resumeHarnessPrompt(output),
    button: formatHarnessButton,
  });
}

export function formatResumeListActionMessage(output: ResumeListOutput): ResumeActionMessage {
  return {
    ...normalizeTextInput(formatResumeList(output)),
    buttons: formatActionButtonRows(
      output.group.sessions.map((session) =>
        formatResumeButton({ harnessId: session.harnessId, shortId: session.shortId }),
      ),
    ),
  };
}

export function formatResumeFailure(error: ResumeCommandError): ChatTextInput {
  const shared = formatSessionCommandFailure(
    error,
    "resume",
    "list sessions",
    "to see available sessions",
  );

  if (shared) return shared;

  if (CommandHarnessNotConfiguredError.is(error)) {
    return formatHarnessNotConfigured(error);
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

  lines.push(`- Model: ${inlineCode(`${output.model.providerId}/${output.model.modelId}`)}`);

  lines.push(`- Directory: ${inlineCode(output.session.cwd)}`);
  lines.push("");
  lines.push("Send a message to continue the conversation.");

  return markdown({ text: lines.join("\n") });
}

function formatResumeHarnesses(output: ResumeHarnessesOutput): ChatTextInput {
  return formatHarnessChoice(resumeHarnessPrompt(output));
}

function resumeHarnessPrompt(output: ResumeHarnessesOutput): HarnessChoicePrompt {
  return {
    cwd: output.cwd,
    harnessIds: output.harnessIds,
    pickHint: "Pick one to view sessions.",
    emptyHint: "Add a harness before resuming sessions.",
  };
}

function formatHarnessButton(harnessId: string): ChatButtonInput<Actions> {
  return {
    id: `resume-harness-${harnessId}`,
    label: `${harnessId} sessions`,
    actionId: resumeHarnessActionId,
    value: "x",
    payload: harnessId,
    style: "secondary",
  };
}

function formatResumeButton(input: {
  readonly harnessId: string;
  readonly shortId: string;
}): ChatButtonInput<Actions> {
  return {
    id: `resume-session-${input.harnessId}-${input.shortId}`,
    label: `Resume ${input.shortId}`,
    actionId: resumeSessionActionId,
    value: "x",
    payload: `${input.harnessId}:${input.shortId}`,
    style: "primary",
  };
}
