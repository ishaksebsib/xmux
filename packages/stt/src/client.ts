import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextConfigError } from "./errors";
import {
  createOpenAICompatibleSpeechToTextClient,
  normalizeOpenAICompatibleSpeechToTextConfig,
  type NormalizedOpenAICompatibleConfig,
  type OpenAICompatibleSpeechToTextConfig,
} from "./providers/openai-compatible";
import type { SpeechToTextClient } from "./types";

export type SpeechToTextClientConfig = OpenAICompatibleSpeechToTextConfig;
export type SttClientConfig = SpeechToTextClientConfig;
export type SpeechToTextCreateClientError = SpeechToTextConfigError;

export type ParsedSpeechToTextClientConfig = {
  readonly provider: "openai-compatible";
  readonly config: NormalizedOpenAICompatibleConfig;
};

export function parseSpeechToTextClientConfig(
  config: SpeechToTextClientConfig,
): ResultType<ParsedSpeechToTextClientConfig, SpeechToTextConfigError> {
  const provider = config.provider ?? "openai-compatible";
  if (provider !== "openai-compatible") {
    return Result.err(
      new SpeechToTextConfigError({ reason: `unsupported provider: ${String(provider)}` }),
    );
  }

  return Result.map(normalizeOpenAICompatibleSpeechToTextConfig(config), (normalized) => ({
    provider,
    config: normalized,
  }));
}

export function createSpeechToTextClient(
  config: SpeechToTextClientConfig,
): ResultType<SpeechToTextClient, SpeechToTextCreateClientError> {
  return Result.map(parseSpeechToTextClientConfig(config), (parsed) => {
    switch (parsed.provider) {
      case "openai-compatible":
        return createOpenAICompatibleSpeechToTextClient(parsed.config);
    }
  });
}

export const createSttClient = createSpeechToTextClient;
