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

const TRANSCRIPT_PREVIEW_MAX_CHARS = 1600;

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
    text: ["**Transcribing...**", "", "Please wait."].join("\n"),
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
    text: ["**Transcription ready**", "", markdownText(transcriptPreview(input.transcript))].join(
      "\n",
    ),
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

export function formatSttFailedAction(error: SttTranscribeError): ActionMessage {
  return {
    text: ["**Transcription failed**", "", markdownText(error.message)].join("\n"),
    format: "markdown",
    buttons: [],
  };
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

export function formatSttSendRetryAction(input: {
  readonly runId: string;
  readonly message: string;
}): ActionMessage {
  return {
    text: ["**Cannot send transcription**", "", markdownText(input.message)].join("\n"),
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

function transcriptPreview(transcript: string): string {
  if (transcript.length <= TRANSCRIPT_PREVIEW_MAX_CHARS) return transcript;

  return [
    transcript.slice(0, TRANSCRIPT_PREVIEW_MAX_CHARS).trimEnd(),
    "",
    "[Transcript preview truncated. Press Send to use the full transcription.]",
  ].join("\n");
}
