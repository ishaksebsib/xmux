import type { ChatTextInput } from "@xmux/chat-core";
import { markdown, markdownText } from "../../components";
import { sttActionId } from "../../actions";
import type { ActionMessage } from "../utils";
import { formatActionButtonRows } from "../button-layout";
import type {
  SttSendTranscriptError,
  SttTranscribeError,
  SttUnsupportedAudioMessageError,
} from "./errors";

export function formatSttDisabledMessage(): ChatTextInput {
  return markdown({
    text: [
      "**STT is not enabled**",
      "",
      "Configure `stt` in xmux config to transcribe voice messages.",
    ].join("\n"),
  });
}

export function formatSttStartedAction(runId: string): ActionMessage {
  return {
    text: ["🎙️ **Transcribing...**", "", "Please wait."].join("\n"),
    format: "markdown",
    buttons: formatActionButtonRows([
      {
        id: `stt-cancel-${runId}`,
        label: "Cancel",
        actionId: sttActionId,
        value: "cancel",
        payload: runId,
        style: "danger",
      },
    ]),
  };
}

export function formatSttTranscriptAction(input: {
  readonly runId: string;
  readonly transcript: string;
}): ActionMessage {
  return {
    text: ["✅ **Transcription ready**", "", markdownText(input.transcript)].join("\n"),
    format: "markdown",
    buttons: formatActionButtonRows([
      {
        id: `stt-send-${input.runId}`,
        label: "Send",
        actionId: sttActionId,
        value: "send",
        payload: input.runId,
        style: "success",
      },
    ]),
  };
}

export function formatSttFailedMessage(error: SttTranscribeError): ChatTextInput {
  return markdown({
    text: ["**Transcription failed**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatSttUnsupportedMessage(error: SttUnsupportedAudioMessageError): ChatTextInput {
  return markdown({
    text: ["**Audio message unsupported**", "", markdownText(error.message)].join("\n"),
  });
}

export function formatSttCancelledAction(): ActionMessage {
  return { text: "**Transcription cancelled**", format: "markdown", buttons: [] };
}

export function formatSttNotRunningAction(): ActionMessage {
  return { text: "**Transcription is no longer running**", format: "markdown", buttons: [] };
}

export function formatSttSendingAction(): ActionMessage {
  return { text: "**Sending transcription...**", format: "markdown", buttons: [] };
}

export function formatSttSentAction(): ActionMessage {
  return { text: "**Transcription sent**", format: "markdown", buttons: [] };
}

export function formatSttSendUnavailableAction(error: SttSendTranscriptError): ActionMessage {
  return {
    text: ["**Cannot send transcription**", "", markdownText(error.message)].join("\n"),
    format: "markdown",
    buttons: [],
  };
}
