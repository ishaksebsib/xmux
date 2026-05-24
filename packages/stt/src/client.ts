import type { SpeechToTextClient, SpeechToTextClientConfig } from "./contracts";
import { createOpenAICompatibleSpeechToTextClient } from "./openai-compatible";

export function createSpeechToTextClient(config: SpeechToTextClientConfig): SpeechToTextClient {
  return createOpenAICompatibleSpeechToTextClient(config);
}
