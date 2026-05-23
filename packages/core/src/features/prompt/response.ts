import type { ChatTextInput } from "@xmux/chat-core";
import { inlineCode, markdown, markdownText } from "../../components";
import {
  PromptAlreadyRunningError,
  PromptNoActiveSessionError,
  PromptSessionClosedError,
  PromptSessionRecordMissingError,
} from "./errors";
import type { PromptSessionForThreadError } from "./service";

export function formatPromptFailure(error: PromptSessionForThreadError): ChatTextInput {
  if (PromptNoActiveSessionError.is(error)) {
    return markdown({
      text: [
        "**No active session**",
        "",
        "Create or resume a session before sending a prompt.",
        "",
        `Use ${inlineCode("/new <harnessId>")} or ${inlineCode("/resume")} to continue conversation.`,
      ].join("\n"),
    });
  }

  if (PromptSessionClosedError.is(error)) {
    return markdown({
      text: [
        "**Session is closed**",
        "",
        `Start a new session with ${inlineCode("/new <harnessId>")}.`,
      ].join("\n"),
    });
  }

  if (PromptAlreadyRunningError.is(error)) {
    return markdown({
      text: [
        "**Session is busy**",
        "",
        "Wait for the current response to finish, then send another message.",
      ].join("\n"),
    });
  }

  if (PromptSessionRecordMissingError.is(error)) {
    return markdown({
      text: ["**Failed to route prompt**", "", markdownText(error.message)].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to prompt session**", "", markdownText(error.message)].join("\n"),
  });
}
