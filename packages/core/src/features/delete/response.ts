import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import type { Actions } from "../../actions";
import { deleteHarnessActionId, deleteSessionActionId } from "../../actions";
import {
  formatCommandHelp,
  formatHarnessNotConfigured,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import { CommandHarnessNotConfiguredError } from "../errors";
import {
  formatHarnessChoice,
  harnessSelectionMessage,
  type HarnessChoicePrompt,
} from "../shared/harness-selection";
import { formatSessionCommandFailure } from "../shared/session-command";
import { normalizeTextInput, type ActionMessage } from "../utils";
import type {
  DeleteCommandError,
  DeleteCommandOutput,
  DeleteHarnessesOutput,
  DeleteListOutput,
} from "./service";

export type DeleteActionMessage = ActionMessage;

export function formatDeleteOutput(output: DeleteCommandOutput): ChatTextInput {
  if (output.status === "harnesses") return formatDeleteHarnesses(output);
  if (output.status === "listed") return formatDeleteList(output);
  return formatDeleteSuccess(output);
}

export function formatDeleteList(output: DeleteListOutput): ChatTextInput {
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
    `Use ${inlineCode(`/delete ${output.group.harnessId} <shortId>`)} or press Delete.`,
    "",
  ];

  for (const session of output.group.sessions) {
    const title = session.title?.trim() || "Untitled session";
    lines.push(
      [
        `- Title: ${markdownText(title)}`,
        `  Short ID: ${inlineCode(session.shortId)}`,
        `  Command: ${inlineCode(`/delete ${session.harnessId} ${session.shortId}`)}`,
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

export function formatDeleteHarnessActionMessage(
  output: DeleteHarnessesOutput,
): DeleteActionMessage {
  return harnessSelectionMessage({
    prompt: deleteHarnessPrompt(output),
    button: formatHarnessButton,
  });
}

export function formatDeleteListActionMessage(output: DeleteListOutput): DeleteActionMessage {
  return {
    ...normalizeTextInput(formatDeleteList(output)),
    buttons: output.group.sessions.map((session) => [
      formatDeleteButton({ harnessId: session.harnessId, shortId: session.shortId }),
    ]),
  };
}

export function formatDeleteFailure(error: DeleteCommandError): ChatTextInput {
  const shared = formatSessionCommandFailure(
    error,
    "delete",
    "delete the active session or list sessions",
    "to see deletable sessions",
  );

  if (shared) return shared;

  if (CommandHarnessNotConfiguredError.is(error)) {
    return formatHarnessNotConfigured(error);
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

function formatDeleteHarnesses(output: DeleteHarnessesOutput): ChatTextInput {
  return formatHarnessChoice(deleteHarnessPrompt(output));
}

function deleteHarnessPrompt(output: DeleteHarnessesOutput): HarnessChoicePrompt {
  return {
    cwd: output.cwd,
    harnessIds: output.harnessIds,
    pickHint: "Pick one to view sessions.",
    emptyHint: "Add a harness before deleting sessions.",
  };
}

function formatHarnessButton(harnessId: string): ChatButtonInput<Actions> {
  return {
    id: `delete-harness-${harnessId}`,
    label: `${harnessId} sessions`,
    actionId: deleteHarnessActionId,
    value: "x",
    payload: harnessId,
    style: "secondary",
  };
}

function formatDeleteButton(input: {
  readonly harnessId: string;
  readonly shortId: string;
}): ChatButtonInput<Actions> {
  return {
    id: `delete-session-${input.harnessId}-${input.shortId}`,
    label: `Delete ${input.shortId}`,
    actionId: deleteSessionActionId,
    value: "x",
    payload: `${input.harnessId}:${input.shortId}`,
    style: "danger",
  };
}
