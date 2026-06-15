import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown, markdownText } from "./markdown";

/**
 * Shared generic failure formatter for command responses.
 * Renders "**Failed to <action>**" followed by the error's message.
 */
export function formatFailure(action: string, error: { readonly message: string }): ChatTextInput {
  return markdown({
    text: [`**Failed to ${markdownText(action)}**`, "", markdownText(error.message)].join("\n"),
  });
}

/**
 * Shared "unknown harness" response for commands that accept a harnessId.
 */
export function formatHarnessNotConfigured(error: {
  readonly harnessId: string;
  readonly availableHarnessIds: readonly string[];
}): ChatTextInput {
  const available =
    error.availableHarnessIds.length > 0
      ? error.availableHarnessIds.map((id) => `- ${inlineCode(id)}`).join("\n")
      : "none";

  return markdown({
    text: [
      `**Error:** Unknown harness ${inlineCode(error.harnessId)}`,
      "",
      "Available harnesses",
      available,
    ].join("\n"),
  });
}
