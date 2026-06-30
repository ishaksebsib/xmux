import type { ChatButtonInput, ChatTextInput } from "@xmux/chat-core";
import { formatSessionDeletedUpstreamMessage, markdown, markdownText } from "../../components";
import { sessionStartActionId, type Actions } from "../../actions";
import type { ActionMessage } from "../utils";
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

export function formatNoActivePromptActionMessage(): ActionMessage {
  return {
    text: ["**No active session**", "", "Create or resume a session before sending a prompt."].join(
      "\n",
    ),
    format: "markdown",
    buttons: [[formatStartNewSessionButton(), formatResumeSessionButton()]],
  };
}

export function formatPromptFailure(error: PromptSessionForThreadError): ChatTextInput {
  if (NoActiveSessionError.is(error)) {
    return markdown({
      text: [
        "**No active session**",
        "",
        "Create or resume a session before sending a prompt.",
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

function formatStartNewSessionButton(): ChatButtonInput<Actions> {
  return {
    id: "no-active-session-new",
    label: "New session",
    actionId: sessionStartActionId,
    value: "new",
    style: "success",
  };
}

function formatResumeSessionButton(): ChatButtonInput<Actions> {
  return {
    id: "no-active-session-resume",
    label: "Resume session",
    actionId: sessionStartActionId,
    value: "resume",
    style: "primary",
  };
}
