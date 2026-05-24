import type { Result } from "better-result";
import type {
  SpeechToTextConfigError,
  SpeechToTextFileReadError,
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

export interface OpenAICompatibleSpeechToTextConfig {
  readonly provider?: "openai-compatible";
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly endpointPath?: string;
  readonly model: string;
  readonly headers?: SpeechToTextHeaders;
  readonly organization?: string;
  readonly project?: string;
  readonly fetch?: SpeechToTextFetch;
  readonly timeoutMs?: number;
}

export type SpeechToTextClientConfig = OpenAICompatibleSpeechToTextConfig;

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

export type SpeechToTextError =
  | SpeechToTextConfigError
  | SpeechToTextRequestError
  | SpeechToTextResponseError
  | SpeechToTextParseError;

export type SpeechToTextAudioFileError = SpeechToTextFileReadError;

export interface SpeechToTextClient {
  transcribe(
    input: SpeechToTextTranscribeInput,
  ): Promise<Result<SpeechToTextTranscript, SpeechToTextError>>;
}
