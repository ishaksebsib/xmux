import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextInputError } from "../../errors";
import type {
  SpeechToTextAudioInput,
  SpeechToTextResponseFormat,
  SpeechToTextTimestampGranularity,
  SpeechToTextTranscribeInput,
} from "../../types";

const responseFormats = new Set<SpeechToTextResponseFormat>([
  "json",
  "text",
  "srt",
  "verbose_json",
  "vtt",
]);

const timestampGranularities = new Set<SpeechToTextTimestampGranularity>(["segment", "word"]);

const reservedExtraBodyFields = new Set([
  "file",
  "model",
  "language",
  "prompt",
  "temperature",
  "response_format",
  "timestamp_granularities",
  "timestamp_granularities[]",
]);

export type ValidatedTranscribeInput = {
  readonly input: SpeechToTextTranscribeInput;
  readonly model: string;
  readonly responseFormat: SpeechToTextResponseFormat;
};

export function validateOpenAICompatibleTranscribeInput(input: {
  readonly input: SpeechToTextTranscribeInput;
  readonly defaultModel: string;
}): ResultType<ValidatedTranscribeInput, SpeechToTextInputError> {
  const model = input.input.model ?? input.defaultModel;
  if (typeof model !== "string" || model.trim().length === 0) {
    return Result.err(new SpeechToTextInputError({ reason: "model must not be empty" }));
  }

  return Result.andThen(validateAudioInput(input.input.audio), () => {
    const responseFormat = input.input.responseFormat ?? "json";
    if (!responseFormats.has(responseFormat)) {
      return Result.err(
        new SpeechToTextInputError({
          reason: `unsupported responseFormat: ${String(responseFormat)}`,
        }),
      );
    }

    if (
      input.input.temperature !== undefined &&
      (!Number.isFinite(input.input.temperature) ||
        input.input.temperature < 0 ||
        input.input.temperature > 1)
    ) {
      return Result.err(
        new SpeechToTextInputError({ reason: "temperature must be a number between 0 and 1" }),
      );
    }

    for (const granularity of input.input.timestampGranularities ?? []) {
      if (!timestampGranularities.has(granularity)) {
        return Result.err(
          new SpeechToTextInputError({
            reason: `unsupported timestamp granularity: ${String(granularity)}`,
          }),
        );
      }
    }

    if (
      (input.input.timestampGranularities?.length ?? 0) > 0 &&
      responseFormat !== "verbose_json"
    ) {
      return Result.err(
        new SpeechToTextInputError({
          reason: "timestampGranularities require responseFormat to be verbose_json",
        }),
      );
    }

    for (const [name, value] of Object.entries(input.input.extraBody ?? {})) {
      if (reservedExtraBodyFields.has(name)) {
        return Result.err(
          new SpeechToTextInputError({
            reason: `extraBody cannot override reserved field: ${name}`,
          }),
        );
      }

      if (!isFormValue(value)) {
        return Result.err(
          new SpeechToTextInputError({
            reason: `extraBody field ${name} has an unsupported value`,
          }),
        );
      }
    }

    return Result.ok({ input: input.input, model, responseFormat });
  });
}

function validateAudioInput(
  input: SpeechToTextAudioInput,
): ResultType<void, SpeechToTextInputError> {
  if (!input || typeof input !== "object") {
    return Result.err(new SpeechToTextInputError({ reason: "audio is required" }));
  }

  if (input.source === "bytes") {
    if (typeof input.filename !== "string" || input.filename.trim().length === 0) {
      return Result.err(
        new SpeechToTextInputError({ reason: "byte audio inputs require a filename" }),
      );
    }

    if (!isArrayBufferLikeInput(input.data)) {
      return Result.err(
        new SpeechToTextInputError({ reason: "byte audio data must be an ArrayBuffer or view" }),
      );
    }

    return Result.ok(undefined);
  }

  if (input.source === "blob") {
    if (!(input.data instanceof Blob)) {
      return Result.err(new SpeechToTextInputError({ reason: "blob audio data must be a Blob" }));
    }

    if (input.filename !== undefined && input.filename.trim().length === 0) {
      return Result.err(
        new SpeechToTextInputError({ reason: "blob audio filename must not be empty" }),
      );
    }

    return Result.ok(undefined);
  }

  return Result.err(new SpeechToTextInputError({ reason: "audio source must be bytes or blob" }));
}

function isArrayBufferLikeInput(input: unknown): input is ArrayBuffer | ArrayBufferView {
  return input instanceof ArrayBuffer || ArrayBuffer.isView(input);
}

function isFormValue(value: unknown): boolean {
  return ["string", "number", "boolean"].includes(typeof value) || value instanceof Blob;
}
