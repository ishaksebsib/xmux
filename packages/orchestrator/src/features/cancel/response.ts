import type { ChatTextInput } from "@xmux/chat-core";
import {
  formatCommandHelp,
  formatNoActiveSessionMessage,
  formatSessionDeletedUpstreamMessage,
  markdown,
  markdownText,
} from "../../components";
import { SessionDeletedUpstreamError } from "../errors";
import type { CancelActivePromptError, CancelActivePromptOutput } from "./service";

export function formatCancelOutput(output: CancelActivePromptOutput): ChatTextInput {
  switch (output.status) {
    case "cancelled":
      return markdown({ text: "**Generation cancelled**" });
    case "not_running":
      return markdown({ text: "**No generation is running**" });
    case "not_active":
      return formatNoActiveSessionMessage({
        description: "There is no active session to cancel.",
        nextStep: "continue.",
      });
  }
}

export function formatCancelFailure(error: CancelActivePromptError): ChatTextInput {
  if (SessionDeletedUpstreamError.is(error)) {
    return formatSessionDeletedUpstreamMessage({
      harnessId: error.ref.harnessId,
      sessionId: error.ref.sessionId,
    });
  }

  return markdown({
    text: ["**Failed to cancel generation**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatCancelCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/cancel",
    summary: "cancel active generation",
    description: "Cancel the active harness generation for this chat thread.",
    usage: "/cancel",
    examples: ["/cancel"],
  });
}
