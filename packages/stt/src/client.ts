import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextConfigError } from "./errors";
import {
  createOpenAICompatibleSpeechToTextClient,
  normalizeOpenAICompatibleSpeechToTextConfig,
  type OpenAICompatibleSpeechToTextConfig,
} from "./providers/openai-compatible";
import type { SpeechToTextClient } from "./types";

export type SpeechToTextClientConfig = OpenAICompatibleSpeechToTextConfig;
export type SttClientConfig = SpeechToTextClientConfig;
export type SpeechToTextCreateClientError = SpeechToTextConfigError;

export function createSpeechToTextClient(
  config: SpeechToTextClientConfig,
): ResultType<SpeechToTextClient, SpeechToTextCreateClientError> {
  const provider = (config as { readonly provider?: string }).provider ?? "openai-compatible";

  if (provider !== "openai-compatible") {
    return Result.err(
      new SpeechToTextConfigError({ reason: `unsupported provider: ${String(provider)}` }),
    );
  }

  return Result.map(normalizeOpenAICompatibleSpeechToTextConfig(config), (normalized) =>
    createOpenAICompatibleSpeechToTextClient(normalized),
  );
}

export const createSttClient = createSpeechToTextClient;
