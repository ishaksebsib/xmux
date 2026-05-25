import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown } from "./markdown";

export interface NoActiveSessionMessageInput {
  readonly description: string;
  readonly nextStep: string;
}

/** Shared no-active-session response for commands that need an attached session. */
export function formatNoActiveSessionMessage(input: NoActiveSessionMessageInput): ChatTextInput {
  return markdown({
    text: [
      "**No active session**",
      "",
      input.description,
      "",
      `Use ${inlineCode("/new <harnessId>")} or ${inlineCode("/resume")} to ${input.nextStep}`,
    ].join("\n"),
  });
}
