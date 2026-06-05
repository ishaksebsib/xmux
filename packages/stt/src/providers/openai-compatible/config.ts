import { Result, type Result as ResultType } from "better-result";
import type { SpeechToTextFetch, SpeechToTextHeaders } from "../../types";
import { SpeechToTextConfigError } from "../../errors";

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultEndpointPath = "/audio/transcriptions";

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

export type NormalizedOpenAICompatibleConfig = {
  readonly url: string;
  readonly model: string;
  readonly headers: Headers;
  readonly fetch: SpeechToTextFetch;
  readonly timeoutMs?: number;
};

export function normalizeOpenAICompatibleSpeechToTextConfig(
  config: OpenAICompatibleSpeechToTextConfig,
): ResultType<NormalizedOpenAICompatibleConfig, SpeechToTextConfigError> {
  if (config.provider !== undefined && config.provider !== "openai-compatible") {
    return Result.err(
      new SpeechToTextConfigError({ reason: `unsupported provider: ${String(config.provider)}` }),
    );
  }

  if (typeof config.model !== "string" || config.model.trim().length === 0) {
    return Result.err(new SpeechToTextConfigError({ reason: "model must not be empty" }));
  }

  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
  ) {
    return Result.err(new SpeechToTextConfigError({ reason: "timeoutMs must be greater than 0" }));
  }

  const fetchImplementation = config.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    return Result.err(new SpeechToTextConfigError({ reason: "fetch implementation is required" }));
  }

  return Result.gen(function* () {
    const url = yield* createEndpointUrl({
      baseUrl: config.baseUrl ?? defaultBaseUrl,
      endpointPath: config.endpointPath ?? defaultEndpointPath,
    });
    const headers = yield* createBaseHeaders(config);

    return Result.ok({
      url,
      model: config.model,
      headers,
      fetch: fetchImplementation,
      timeoutMs: config.timeoutMs,
    });
  });
}

function createEndpointUrl(input: {
  readonly baseUrl: string;
  readonly endpointPath: string;
}): ResultType<string, SpeechToTextConfigError> {
  if (input.baseUrl.trim().length === 0) {
    return Result.err(new SpeechToTextConfigError({ reason: "baseUrl must not be empty" }));
  }

  if (input.endpointPath.trim().length === 0) {
    return Result.err(new SpeechToTextConfigError({ reason: "endpointPath must not be empty" }));
  }

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

function createBaseHeaders(
  config: OpenAICompatibleSpeechToTextConfig,
): ResultType<Headers, SpeechToTextConfigError> {
  return Result.try({
    try: () => {
      const headers = new Headers(config.headers);
      if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
      if (config.organization) headers.set("openai-organization", config.organization);
      if (config.project) headers.set("openai-project", config.project);
      return headers;
    },
    catch: (cause) =>
      new SpeechToTextConfigError({ reason: `invalid provider headers: ${String(cause)}` }),
  });
}
