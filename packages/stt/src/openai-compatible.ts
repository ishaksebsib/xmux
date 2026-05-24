import { Result, type Result as ResultType } from "better-result";
import type {
  OpenAICompatibleSpeechToTextConfig,
  SpeechToTextAudioInput,
  SpeechToTextClient,
  SpeechToTextError,
  SpeechToTextFormValue,
  SpeechToTextResponseFormat,
  SpeechToTextSegment,
  SpeechToTextTranscribeInput,
  SpeechToTextWord,
} from "./contracts";
import {
  SpeechToTextConfigError,
  SpeechToTextParseError,
  SpeechToTextRequestError,
  SpeechToTextResponseError,
} from "./errors";

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultEndpointPath = "/audio/transcriptions";

type NormalizedOpenAICompatibleConfig = {
  readonly url: string;
  readonly model: string;
  readonly headers: Headers;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
};

type BlobConstructorPart = NonNullable<ConstructorParameters<typeof Blob>[0]>[number];

export function createOpenAICompatibleSpeechToTextClient(
  config: OpenAICompatibleSpeechToTextConfig,
): SpeechToTextClient {
  return {
    async transcribe(input) {
      const normalized = normalizeConfig(config);
      if (normalized.isErr()) return Result.err(normalized.error);

      const model = input.model ?? normalized.value.model;
      if (model.trim().length === 0) {
        return Result.err(new SpeechToTextConfigError({ reason: "model must not be empty" }));
      }

      const body = createTranscriptionFormData({ input, model });
      const signal = createRequestSignal({
        signal: input.signal,
        timeoutMs: normalized.value.timeoutMs,
      });

      const response = await Result.tryPromise({
        try: () =>
          normalized.value.fetch(normalized.value.url, {
            method: "POST",
            headers: mergeHeaders(normalized.value.headers, input.headers),
            body,
            signal: signal.signal,
          }),
        catch: (cause) => new SpeechToTextRequestError({ url: normalized.value.url, cause }),
      });
      signal.cleanup();

      if (response.isErr()) return Result.err(response.error);

      if (!response.value.ok) {
        return Result.err(
          new SpeechToTextResponseError({
            url: normalized.value.url,
            status: response.value.status,
            detail: await readResponseText(response.value),
          }),
        );
      }

      return parseTranscriptionResponse({
        response: response.value,
        format: input.responseFormat ?? "json",
        url: normalized.value.url,
      });
    },
  };
}

function normalizeConfig(
  config: OpenAICompatibleSpeechToTextConfig,
): ResultType<NormalizedOpenAICompatibleConfig, SpeechToTextConfigError> {
  if (config.provider !== undefined && config.provider !== "openai-compatible") {
    return Result.err(
      new SpeechToTextConfigError({ reason: `unsupported provider: ${String(config.provider)}` }),
    );
  }

  if (config.model.trim().length === 0) {
    return Result.err(new SpeechToTextConfigError({ reason: "model must not be empty" }));
  }

  if (config.timeoutMs !== undefined && config.timeoutMs <= 0) {
    return Result.err(new SpeechToTextConfigError({ reason: "timeoutMs must be greater than 0" }));
  }

  const fetchImplementation = config.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    return Result.err(new SpeechToTextConfigError({ reason: "fetch implementation is required" }));
  }

  const url = createEndpointUrl({
    baseUrl: config.baseUrl ?? defaultBaseUrl,
    endpointPath: config.endpointPath ?? defaultEndpointPath,
  });
  if (url.isErr()) return Result.err(url.error);

  return Result.ok({
    url: url.value,
    model: config.model,
    headers: createBaseHeaders(config),
    fetch: fetchImplementation,
    timeoutMs: config.timeoutMs,
  });
}

function createEndpointUrl(input: {
  readonly baseUrl: string;
  readonly endpointPath: string;
}): ResultType<string, SpeechToTextConfigError> {
  return Result.try({
    try: () => {
      const baseUrl = input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`;
      const endpointPath = input.endpointPath.startsWith("/")
        ? input.endpointPath.slice(1)
        : input.endpointPath;

      return new URL(endpointPath, baseUrl).toString();
    },
    catch: (cause) =>
      new SpeechToTextConfigError({ reason: `invalid provider URL: ${String(cause)}` }),
  });
}

function createBaseHeaders(config: OpenAICompatibleSpeechToTextConfig): Headers {
  const headers = new Headers(config.headers);
  if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
  if (config.organization) headers.set("openai-organization", config.organization);
  if (config.project) headers.set("openai-project", config.project);
  return headers;
}

function mergeHeaders(
  baseHeaders: Headers,
  overrideHeaders: SpeechToTextTranscribeInput["headers"],
): Headers {
  const headers = new Headers(baseHeaders);
  for (const [name, value] of Object.entries(overrideHeaders ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

function createTranscriptionFormData(input: {
  readonly input: SpeechToTextTranscribeInput;
  readonly model: string;
}): FormData {
  const body = new FormData();
  const file = toFormDataFile(input.input.audio);

  body.append("file", file.blob, file.filename);
  body.append("model", input.model);
  appendOptional(body, "language", input.input.language);
  appendOptional(body, "prompt", input.input.prompt);
  appendOptional(body, "temperature", input.input.temperature);
  appendOptional(body, "response_format", input.input.responseFormat);

  for (const granularity of input.input.timestampGranularities ?? []) {
    body.append("timestamp_granularities[]", granularity);
  }

  for (const [name, value] of Object.entries(input.input.extraBody ?? {})) {
    appendFormValue(body, name, value);
  }

  return body;
}

function toFormDataFile(input: SpeechToTextAudioInput): {
  readonly blob: Blob;
  readonly filename: string;
} {
  if (input.source === "blob") {
    const blob = input.mimeType ? new Blob([input.data], { type: input.mimeType }) : input.data;
    return { blob, filename: input.filename ?? "audio" };
  }

  return {
    blob: new Blob([toBlobPart(input.data)], { type: input.mimeType }),
    filename: input.filename,
  };
}

function toBlobPart(input: ArrayBuffer | ArrayBufferView): BlobConstructorPart {
  if (input instanceof ArrayBuffer) return input;

  const bytes = new Uint8Array(input.byteLength);
  bytes.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  return bytes;
}

function appendOptional(body: FormData, name: string, value: string | number | undefined): void {
  if (value !== undefined) body.append(name, String(value));
}

function appendFormValue(body: FormData, name: string, value: SpeechToTextFormValue): void {
  if (value instanceof Blob) {
    body.append(name, value);
    return;
  }

  body.append(name, String(value));
}

function createRequestSignal(input: {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): { readonly signal?: AbortSignal; readonly cleanup: () => void } {
  if (!input.timeoutMs) return { signal: input.signal, cleanup: () => undefined };

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason);
  const timeout = setTimeout(
    () => controller.abort(new Error("Speech-to-text request timed out")),
    input.timeoutMs,
  );

  if (input.signal?.aborted) abortFromParent();
  else input.signal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function parseTranscriptionResponse(input: {
  readonly response: Response;
  readonly format: SpeechToTextResponseFormat;
  readonly url: string;
}): Promise<ResultType<SpeechToTextTranscribeOutput, SpeechToTextParseError>> {
  if (input.format === "text" || input.format === "srt" || input.format === "vtt") {
    const text = await Result.tryPromise({
      try: () => input.response.text(),
      catch: (cause) => new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
    });

    return text.isOk()
      ? Result.ok({ text: text.value, raw: text.value, format: input.format })
      : Result.err(text.error);
  }

  const json = await Result.tryPromise({
    try: () => input.response.json() as Promise<unknown>,
    catch: (cause) => new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
  });

  if (json.isErr()) return Result.err(json.error);
  if (!isRecord(json.value) || typeof json.value.text !== "string") {
    return Result.err(new SpeechToTextParseError({ url: input.url, format: input.format }));
  }

  return Result.ok({
    text: json.value.text,
    language: getString(json.value.language),
    duration: getNumber(json.value.duration),
    segments: toSegments(json.value.segments),
    words: toWords(json.value.words),
    raw: json.value,
    format: input.format,
  });
}

type SpeechToTextTranscribeOutput =
  Awaited<ReturnType<SpeechToTextClient["transcribe"]>> extends ResultType<
    infer TOutput,
    SpeechToTextError
  >
    ? TOutput
    : never;

async function readResponseText(response: Response): Promise<string | undefined> {
  const text = await Result.tryPromise({
    try: () => response.text(),
    catch: () => undefined,
  });

  return text.isOk() && text.value.length > 0 ? text.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toSegments(value: unknown): readonly SpeechToTextSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((segment): SpeechToTextSegment[] => {
    if (!isRecord(segment) || typeof segment.text !== "string") return [];

    return [
      {
        id: getNumber(segment.id),
        start: getNumber(segment.start),
        end: getNumber(segment.end),
        text: segment.text,
      },
    ];
  });
}

function toWords(value: unknown): readonly SpeechToTextWord[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((word): SpeechToTextWord[] => {
    if (!isRecord(word) || typeof word.word !== "string") return [];

    return [
      {
        start: getNumber(word.start),
        end: getNumber(word.end),
        word: word.word,
      },
    ];
  });
}
