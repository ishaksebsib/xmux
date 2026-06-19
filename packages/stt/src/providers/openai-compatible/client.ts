import { Result } from "better-result";
import { SpeechToTextRequestError, SpeechToTextResponseError } from "../../errors";
import type {
  SpeechToTextClient,
  SpeechToTextClientError,
  SpeechToTextTranscript,
} from "../../types";
import type { NormalizedOpenAICompatibleConfig } from "./config";
import { createTranscriptionFormData } from "./form-data";
import { parseTranscriptionResponse } from "./parse";
import { createRequestSignal, mergeHeaders, readResponseText } from "./transport";
import { validateOpenAICompatibleTranscribeInput } from "./validation";

export function createOpenAICompatibleSpeechToTextClient(
  config: NormalizedOpenAICompatibleConfig,
): SpeechToTextClient {
  return {
    async transcribe(input): Promise<Result<SpeechToTextTranscript, SpeechToTextClientError>> {
      const validated = validateOpenAICompatibleTranscribeInput({
        input,
        defaultModel: config.model,
      });

      if (validated.isErr()) return Result.err(validated.error);

      const body = createTranscriptionFormData(validated.value);
      const signal = createRequestSignal({
        signal: validated.value.signal,
        timeoutMs: config.timeoutMs,
      });

      try {
        const response = await Result.tryPromise({
          try: () =>
            config.fetch(config.url, {
              method: "POST",
              headers: mergeHeaders(config.headers, validated.value.headers),
              body,
              signal: signal.signal,
            }),
          catch: (cause) => new SpeechToTextRequestError({ url: config.url, cause }),
        });

        if (response.isErr()) return Result.err(response.error);

        if (!response.value.ok) {
          return Result.err(
            new SpeechToTextResponseError({
              url: config.url,
              status: response.value.status,
              detail: await readResponseText(response.value),
            }),
          );
        }

        return parseTranscriptionResponse({
          response: response.value,
          format: validated.value.responseFormat,
          url: config.url,
        });
      } finally {
        signal.cleanup();
      }
    },
  };
}
