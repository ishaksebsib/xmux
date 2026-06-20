import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextInputError } from "../../errors";
import type {
  SpeechToTextAudioInput,
  SpeechToTextFormValue,
  SpeechToTextHeaders,
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

export type ValidatedAudioInput =
  | {
      readonly source: "blob";
      readonly data: Blob;
      readonly filename: string;
      readonly mimeType?: string;
    }
  | {
      readonly source: "bytes";
      readonly data: ArrayBuffer | ArrayBufferView;
      readonly filename: string;
      readonly mimeType?: string;
    };

export type ValidatedTranscribeInput = {
  readonly audio: ValidatedAudioInput;
  readonly model: string;
  readonly language?: string;
  readonly prompt?: string;
  readonly temperature?: number;
  readonly responseFormat: SpeechToTextResponseFormat;
  readonly timestampGranularities: readonly SpeechToTextTimestampGranularity[];
  readonly extraBody: Readonly<Record<string, SpeechToTextFormValue>>;
  readonly headers?: SpeechToTextHeaders;
  readonly signal?: AbortSignal;
};

export function validateOpenAICompatibleTranscribeInput(input: {
  readonly input: SpeechToTextTranscribeInput;
  readonly defaultModel: string;
}): ResultType<ValidatedTranscribeInput, SpeechToTextInputError> {
  return Result.gen(function* () {
    const model = yield* parseModel(input.input.model ?? input.defaultModel);
    const audio = yield* validateAudioInput(input.input.audio);
    const responseFormat = yield* parseResponseFormat(input.input.responseFormat ?? "json");
    const temperature = yield* parseTemperature(input.input.temperature);
    const timestampGranularities = yield* parseTimestampGranularities(
      input.input.timestampGranularities,
      responseFormat,
    );
    const extraBody = yield* parseExtraBody(input.input.extraBody);

    return Result.ok({
      audio,
      model,
      ...(input.input.language === undefined ? {} : { language: input.input.language }),
      ...(input.input.prompt === undefined ? {} : { prompt: input.input.prompt }),
      ...(temperature === undefined ? {} : { temperature }),
      responseFormat,
      timestampGranularities,
      extraBody,
      ...(input.input.headers === undefined ? {} : { headers: input.input.headers }),
      ...(input.input.signal === undefined ? {} : { signal: input.input.signal }),
    });
  });
}

function parseModel(model: unknown): ResultType<string, SpeechToTextInputError> {
  return typeof model === "string" && model.trim().length > 0
    ? Result.ok(model.trim())
    : Result.err(new SpeechToTextInputError({ reason: "model must not be empty" }));
}

function parseResponseFormat(
  responseFormat: unknown,
): ResultType<SpeechToTextResponseFormat, SpeechToTextInputError> {
  return responseFormats.has(responseFormat as SpeechToTextResponseFormat)
    ? Result.ok(responseFormat as SpeechToTextResponseFormat)
    : Result.err(
        new SpeechToTextInputError({
          reason: `unsupported responseFormat: ${String(responseFormat)}`,
        }),
      );
}

function parseTemperature(
  temperature: number | undefined,
): ResultType<number | undefined, SpeechToTextInputError> {
  if (temperature === undefined) return Result.ok(undefined);
  return Number.isFinite(temperature) && temperature >= 0 && temperature <= 1
    ? Result.ok(temperature)
    : Result.err(
        new SpeechToTextInputError({ reason: "temperature must be a number between 0 and 1" }),
      );
}

function parseTimestampGranularities(
  granularities: readonly SpeechToTextTimestampGranularity[] | undefined,
  responseFormat: SpeechToTextResponseFormat,
): ResultType<readonly SpeechToTextTimestampGranularity[], SpeechToTextInputError> {
  if (granularities === undefined) return Result.ok(Object.freeze([]));

  const parsed: SpeechToTextTimestampGranularity[] = [];
  for (const granularity of granularities) {
    if (!timestampGranularities.has(granularity)) {
      return Result.err(
        new SpeechToTextInputError({
          reason: `unsupported timestamp granularity: ${String(granularity)}`,
        }),
      );
    }
    if (!parsed.includes(granularity)) parsed.push(granularity);
  }

  if (parsed.length > 0 && responseFormat !== "verbose_json") {
    return Result.err(
      new SpeechToTextInputError({
        reason: "timestampGranularities require responseFormat to be verbose_json",
      }),
    );
  }

  return Result.ok(Object.freeze(parsed));
}

function parseExtraBody(
  extraBody: Readonly<Record<string, SpeechToTextFormValue>> | undefined,
): ResultType<Readonly<Record<string, SpeechToTextFormValue>>, SpeechToTextInputError> {
  if (extraBody === undefined) return Result.ok(Object.freeze({}));

  const parsed: Record<string, SpeechToTextFormValue> = {};
  for (const [name, value] of Object.entries(extraBody)) {
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

    parsed[name] = value;
  }

  return Result.ok(Object.freeze(parsed));
}

function validateAudioInput(
  input: SpeechToTextAudioInput,
): ResultType<ValidatedAudioInput, SpeechToTextInputError> {
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

    return Result.ok({
      source: "bytes",
      data: input.data,
      filename: input.filename.trim(),
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
    });
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

    return Result.ok({
      source: "blob",
      data: input.data,
      filename: input.filename?.trim() ?? "audio",
      ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
    });
  }

  return Result.err(new SpeechToTextInputError({ reason: "audio source must be bytes or blob" }));
}

function isArrayBufferLikeInput(input: unknown): input is ArrayBuffer | ArrayBufferView {
  return input instanceof ArrayBuffer || ArrayBuffer.isView(input);
}

function isFormValue(value: unknown): value is SpeechToTextFormValue {
  return ["string", "number", "boolean"].includes(typeof value) || value instanceof Blob;
}
