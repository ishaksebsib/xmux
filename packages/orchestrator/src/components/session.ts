import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown } from "./markdown";

export interface SessionDeletedUpstreamMessageInput {
  readonly harnessId: string;
  readonly sessionId: string;
}

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

/** Shared response for a locally-known session that the native harness no longer has. */
export function formatSessionDeletedUpstreamMessage(
  input: SessionDeletedUpstreamMessageInput,
): ChatTextInput {
  return markdown({
    text: [
      "**Session deleted upstream**",
      "",
      `The native harness no longer has session ${inlineCode(`${input.harnessId}/${input.sessionId}`)}.`,
      "",
      "xmux detached this chat and cleared local routing for that session.",
      "",
      `Use ${inlineCode("/new <harnessId>")} or ${inlineCode("/resume")} to continue.`,
    ].join("\n"),
  });
}
