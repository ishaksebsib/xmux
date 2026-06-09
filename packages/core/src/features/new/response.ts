import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import type { Actions } from "../../actions";
import { newHarnessActionId } from "../../actions";
import {
  formatCommandHelp,
  formatFailure,
  formatHarnessNotConfigured,
  inlineCode,
  markdown,
  markdownText,
} from "../../components";
import type { SessionRecord } from "../../store";
import { CommandHarnessNotConfiguredError } from "../errors";
import {
  formatHarnessChoice,
  harnessSelectionMessage,
  type HarnessChoicePrompt,
  type HarnessSelectionOutput,
} from "../shared/harness-selection";
import type { ActionMessage } from "../utils";
import type { CreateSessionForThreadError, NewCommandOutput } from "./service";

export function formatNewOutput(output: NewCommandOutput): ChatTextInput {
  return output.status === "created"
    ? formatNewSessionSuccess(output.record)
    : formatNewHarnesses(output);
}

export function formatNewSessionSuccess(record: SessionRecord): ChatTextInput {
  const lines = [
    "**Session created**",
    "",
    `Harness: ${inlineCode(record.ref.harnessId)}`,
    `Session ID: ${inlineCode(record.ref.sessionId)}`,
  ];

  if (record.title) {
    lines.push(`Title: ${markdownText(record.title)}`);
  }

  const recommendedNextSteps = [
    "- The session is now active. Send a message to start the conversation.",
  ];

  for (const nextStep of recommendedNextSteps) {
    lines.push(nextStep);
    lines.push("");
  }

  return markdown({ text: lines.join("\n") });
}

/** Builds the harness picker action message shown for a bare `/new`. */
export function formatNewHarnessActionMessage(output: HarnessSelectionOutput): ActionMessage {
  return harnessSelectionMessage({
    prompt: newHarnessPrompt(output),
    button: formatNewHarnessButton,
  });
}

export function formatNewSessionFailure(error: CreateSessionForThreadError): ChatTextInput {
  if (CommandHarnessNotConfiguredError.is(error)) {
    return formatHarnessNotConfigured(error);
  }

  return formatFailure("create session", error);
}

export function formatNewCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/new",
    summary: "create a harness session",
    description: "Start a new coding-agent session in the current workspace directory.",
    usage: "/new <harnessId> [title]",
    examples: ["/new pi", "/new opencode my-session"],
  });
}

function formatNewHarnesses(output: HarnessSelectionOutput): ChatTextInput {
  return formatHarnessChoice(newHarnessPrompt(output));
}

function newHarnessPrompt(output: HarnessSelectionOutput): HarnessChoicePrompt {
  return {
    cwd: output.cwd,
    harnessIds: output.harnessIds,
    pickHint: "Pick one to start a new session.",
    emptyHint: "Add a harness before starting a session.",
  };
}

function formatNewHarnessButton(harnessId: string): ChatButtonInput<Actions> {
  return {
    id: `new-harness-${harnessId}`,
    label: harnessId,
    actionId: newHarnessActionId,
    value: "x",
    payload: harnessId,
    style: "primary",
  };
}
