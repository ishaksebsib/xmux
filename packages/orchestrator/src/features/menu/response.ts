import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import { menuActionId, type Actions } from "../../actions";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../components";
import { formatActionButtonRows } from "../button-layout";
import { formatModelSessionDetailsLines } from "../model/response";
import { normalizeTextInput, type ActionMessage } from "../utils";
import type { MenuCommandItem } from "./item";
import type { ResolveMenuStateError, MenuState } from "./state";

export function formatMenuActionMessage(input: {
  readonly state: MenuState;
  readonly items: readonly MenuCommandItem[];
  readonly notice?: string;
}): ActionMessage {
  return {
    ...normalizeTextInput(formatMenuText(input)),
    buttons: formatActionButtonRows(input.items.map(formatMenuButton)),
  };
}

export function formatMenuFailure(error: ResolveMenuStateError): ChatTextInput {
  return markdown({
    text: ["**Menu unavailable**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatMenuCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/menu",
    summary: "show available actions",
    description: "Show useful actions for the current chat state.",
    usage: "/menu",
    examples: ["/menu"],
  });
}

function formatMenuText(input: {
  readonly state: MenuState;
  readonly items: readonly MenuCommandItem[];
  readonly notice?: string;
}): ChatTextInput {
  const lines = ["**Menu**", ""];

  if (input.notice !== undefined) {
    lines.push(markdownText(input.notice), "");
  }

  lines.push(...formatStateLines(input.state), "");

  if (input.items.length === 0) {
    lines.push("No menu actions are available right now.");
  } else {
    lines.push("Choose an action:");
  }

  return markdown({ text: lines.join("\n") });
}

function formatStateLines(state: MenuState): readonly string[] {
  if (state.session.status === "inactive") {
    return ["No active session."];
  }

  const lines =
    state.session.details.status === "available"
      ? [
          ...formatModelSessionDetailsLines({
            session: state.session.record,
            model: state.session.details.model,
            thinkingSupported: state.session.details.thinkingSupported,
            ...(state.session.details.thinkingLevel === undefined
              ? {}
              : { thinkingLevel: state.session.details.thinkingLevel }),
          }),
        ]
      : [
          `- Harness: ${inlineCode(state.session.record.ref.harnessId)}`,
          `- Session ID: ${inlineCode(state.session.record.ref.sessionId)}`,
        ];

  if (state.session.prompt.status !== "idle") {
    lines.push(`Generation: ${inlineCode(state.session.prompt.status)}`);
  }

  if (state.session.queueCount > 0) {
    lines.push(`Queued prompts: ${inlineCode(String(state.session.queueCount))}`);
  }

  return lines;
}

function formatMenuButton(item: MenuCommandItem): ChatButtonInput<Actions> {
  return {
    id: `menu-${item.id}`,
    label: item.label,
    actionId: menuActionId,
    value: "x",
    payload: item.id,
    style: item.style ?? "secondary",
  };
}
