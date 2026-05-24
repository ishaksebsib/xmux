import { expectTypeOf, test } from "vitest";
import {
  createSpeechToTextClient,
  type OpenAICompatibleSpeechToTextConfig,
  type SpeechToTextClient,
  type SpeechToTextTranscript,
} from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

test("speech-to-text client types stay provider-neutral and strict", () => {
  const client = createSpeechToTextClient({
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "whisper-local",
  });

  expectTypeOf(client).toEqualTypeOf<SpeechToTextClient>();
  expectTypeOf<OpenAICompatibleSpeechToTextConfig>().toMatchTypeOf<{
    readonly provider?: "openai-compatible";
    readonly model: string;
  }>();
  expectTypeOf<SpeechToTextTranscript["text"]>().toEqualTypeOf<string>();

  void client.transcribe({
    audio: {
      source: "bytes",
      data: new Uint8Array([1]),
      filename: "audio.wav",
    },
    model: "gpt-4o-transcribe",
    responseFormat: "json",
    extraBody: { custom_provider_option: true },
  });

  if (shouldRunTypeErrorChecks) {
    void createSpeechToTextClient({
      // @ts-expect-error unsupported providers should not be accepted
      provider: "other-provider",
      model: "whisper-1",
    });

    void client.transcribe({
      // @ts-expect-error byte inputs need a filename for multipart uploads
      audio: {
        source: "bytes",
        data: new Uint8Array([1]),
        mimeType: "audio/wav",
      },
    });
  }
});
