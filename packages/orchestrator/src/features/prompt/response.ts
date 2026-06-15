import type { ChatTextInput } from "@xmux/chat-core";
import { formatNoActiveSessionMessage, inlineCode, markdown, markdownText } from "../../components";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "../errors";
import {
  PromptAlreadyRunningError,
  PromptAttachmentReadError,
  PromptAttachmentStorageError,
  PromptAttachmentTooLargeError,
  PromptAttachmentUnsupportedError,
} from "./errors";
import type { PromptSessionForThreadError } from "./service";

export function formatPromptFailure(error: PromptSessionForThreadError): ChatTextInput {
  if (NoActiveSessionError.is(error)) {
    return formatNoActiveSessionMessage({
      description: "Create or resume a session before sending a prompt.",
      nextStep: "continue conversation.",
    });
  }

  if (SessionClosedError.is(error)) {
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

  if (SessionRecordMissingError.is(error)) {
    return markdown({
      text: ["**Failed to route prompt**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (PromptAttachmentUnsupportedError.is(error)) {
    return markdown({
      text: ["**Attachment unsupported**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (PromptAttachmentTooLargeError.is(error)) {
    return markdown({
      text: ["**Attachment too large**", "", markdownText(error.message)].join("\n"),
    });
  }

  if (PromptAttachmentReadError.is(error) || PromptAttachmentStorageError.is(error)) {
    return markdown({
      text: ["**Failed to prepare attachment**", "", markdownText(error.message)].join("\n"),
    });
  }

  return markdown({
    text: ["**Failed to prompt session**", "", markdownText(error.message)].join("\n"),
  });
}
