import type { ChatTextInput } from "@xmux/chat-core";
import {
  formatNoActiveSessionMessage,
  formatSessionDeletedUpstreamMessage,
  markdown,
  markdownText,
} from "../../components";
import {
  NoActiveSessionError,
  SessionDeletedUpstreamError,
  SessionRecordMissingError,
} from "../errors";
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

  if (SessionDeletedUpstreamError.is(error)) {
    return formatSessionDeletedUpstreamMessage({
      harnessId: error.ref.harnessId,
      sessionId: error.ref.sessionId,
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
