export { createSpeechToTextAudioFromFile } from "./audio";
export { createSpeechToTextClient } from "./client";
export {
  SpeechToTextConfigError,
  SpeechToTextFileReadError,
  SpeechToTextParseError,
  SpeechToTextRequestError,
  SpeechToTextResponseError,
} from "./errors";
export type { CreateSpeechToTextAudioInput } from "./audio";
export type {
  OpenAICompatibleSpeechToTextConfig,
  SpeechToTextAudioFileError,
  SpeechToTextAudioInput,
  SpeechToTextClient,
  SpeechToTextClientConfig,
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
} from "./contracts";
