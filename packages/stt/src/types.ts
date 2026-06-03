import type { Result } from "better-result";
import type {
  SpeechToTextConfigError,
  SpeechToTextInputError,
  SpeechToTextParseError,
  SpeechToTextRequestError,
  SpeechToTextResponseError,
} from "./errors";

export type SpeechToTextProvider = "openai-compatible";

export type SpeechToTextResponseFormat = "json" | "text" | "srt" | "verbose_json" | "vtt";

export type SpeechToTextTimestampGranularity = "segment" | "word";

export type SpeechToTextFormValue = string | number | boolean | Blob;

export type SpeechToTextHeaders = Readonly<Record<string, string>>;

export type SpeechToTextFetch = typeof fetch;

export type SpeechToTextAudioInput =
  | {
      readonly source: "blob";
      readonly data: Blob;
      readonly filename?: string;
      readonly mimeType?: string;
    }
  | {
      readonly source: "bytes";
      readonly data: ArrayBuffer | ArrayBufferView;
      readonly filename: string;
      readonly mimeType?: string;
    };

export interface SpeechToTextTranscribeInput {
  readonly audio: SpeechToTextAudioInput;
  readonly model?: string;
  readonly language?: string;
  readonly prompt?: string;
  readonly temperature?: number;
  readonly responseFormat?: SpeechToTextResponseFormat;
  readonly timestampGranularities?: readonly SpeechToTextTimestampGranularity[];
  readonly extraBody?: Readonly<Record<string, SpeechToTextFormValue>>;
  readonly headers?: SpeechToTextHeaders;
  readonly signal?: AbortSignal;
}

export interface SpeechToTextSegment {
  readonly id?: number;
  readonly start?: number;
  readonly end?: number;
  readonly text: string;
}

export interface SpeechToTextWord {
  readonly start?: number;
  readonly end?: number;
  readonly word: string;
}

export interface SpeechToTextTranscript {
  readonly text: string;
  readonly language?: string;
  readonly duration?: number;
  readonly segments?: readonly SpeechToTextSegment[];
  readonly words?: readonly SpeechToTextWord[];
  readonly raw: unknown;
  readonly format: SpeechToTextResponseFormat;
}

export type SpeechToTextClientError =
  | SpeechToTextInputError
  | SpeechToTextRequestError
  | SpeechToTextResponseError
  | SpeechToTextParseError;

export type SpeechToTextError = SpeechToTextConfigError | SpeechToTextClientError;

export interface SpeechToTextClient {
  transcribe(
    input: SpeechToTextTranscribeInput,
  ): Promise<Result<SpeechToTextTranscript, SpeechToTextClientError>>;
}

export type SttClient = SpeechToTextClient;
export type SttTranscript = SpeechToTextTranscript;
export type SttTranscribeInput = SpeechToTextTranscribeInput;
export type SttAudioInput = SpeechToTextAudioInput;
