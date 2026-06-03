export { createSpeechToTextClient, createSttClient } from "./client";
export {
  SpeechToTextConfigError,
  SpeechToTextInputError,
  SpeechToTextParseError,
  SpeechToTextRequestError,
  SpeechToTextResponseError,
} from "./errors";
export type {
  SpeechToTextClientConfig,
  SpeechToTextCreateClientError,
  SttClientConfig,
} from "./client";
export type { OpenAICompatibleSpeechToTextConfig } from "./providers/openai-compatible";
export type {
  SpeechToTextAudioInput,
  SpeechToTextClient,
  SpeechToTextClientError,
  SpeechToTextError,
  SpeechToTextFetch,
  SpeechToTextFormValue,
  SpeechToTextHeaders,
  SpeechToTextProvider,
  SpeechToTextResponseFormat,
  SpeechToTextSegment,
  SpeechToTextTimestampGranularity,
  SpeechToTextTranscript,
  SpeechToTextTranscribeInput,
  SpeechToTextWord,
  SttAudioInput,
  SttClient,
  SttTranscript,
  SttTranscribeInput,
} from "./types";
