import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import type { Actions } from "../../../actions";
import { inlineCode, markdown } from "../../../components";
import type { ActionMessage } from "../../utils";
import { formatActionButtonRows } from "../../button-layout";
import { normalizeTextInput } from "../../utils";

/** Header text plus the per-state wording for a harness picker prompt. */
export interface HarnessChoicePrompt {
  readonly cwd: string;
  readonly harnessIds: readonly string[];
  /** Sentence shown when at least one harness is configured. */
  readonly pickHint: string;
  /** Sentence shown when no harness is configured. */
  readonly emptyHint: string;
}

/** Renders the "Choose a harness" picker text, or the empty-state variant. */
export function formatHarnessChoice(prompt: HarnessChoicePrompt): ChatTextInput {
  const isEmpty = prompt.harnessIds.length === 0;

  return markdown({
    text: [
      isEmpty ? "**No harnesses configured**" : "**Choose a harness**",
      "",
      `Current directory: ${inlineCode(prompt.cwd)}`,
      "",
      isEmpty ? prompt.emptyHint : prompt.pickHint,
    ].join("\n"),
  });
}

/**
 * Assembles a harness picker action message: the prompt text plus one button
 * per configured harness. Each feature supplies its own `button` factory so the
 * concrete action id stays narrowed (and casts stay out of shared code).
 */
export function harnessSelectionMessage(input: {
  readonly prompt: HarnessChoicePrompt;
  readonly button: (harnessId: string) => ChatButtonInput<Actions>;
}): ActionMessage {
  return {
    ...normalizeTextInput(formatHarnessChoice(input.prompt)),
    buttons: formatActionButtonRows(input.prompt.harnessIds.map((harnessId) => input.button(harnessId))),
  };
}
