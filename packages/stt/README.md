# @xmux/stt

Speech-to-text SDK for OpenAI-compatible transcription APIs.

It works with OpenAI by default and can target compatible local or self-hosted APIs by changing `baseUrl`, `model`, and auth settings.

## Install

```sh
pnpm add @xmux/stt
```

## OpenAI

```ts
import { createSpeechToTextAudioFromFile, createSpeechToTextClient } from "@xmux/stt";

const client = createSpeechToTextClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-transcribe",
});

const audio = await createSpeechToTextAudioFromFile({
  path: "./audio.wav",
  mimeType: "audio/wav",
});

if (audio.isErr()) throw audio.error;

const transcript = await client.transcribe({
  audio: audio.value,
  language: "en",
});

if (transcript.isErr()) throw transcript.error;

console.log(transcript.value.text);
```

## Local Compatible API

Use the same client with local OpenAI-compatible servers such as LM Studio, Ollama gateways, or other proxy runtimes.

```ts
import { createSpeechToTextAudioFromFile, createSpeechToTextClient } from "@xmux/stt";

const client = createSpeechToTextClient({
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "whisper-local",
});

const audio = await createSpeechToTextAudioFromFile({ path: "./audio.mp3" });

if (audio.isOk()) {
  const transcript = await client.transcribe({ audio: audio.value });
  if (transcript.isOk()) console.log(transcript.value.text);
}
```

## Bytes Or Blob Input

```ts
const transcript = await client.transcribe({
  audio: {
    source: "bytes",
    data: new Uint8Array([/* audio bytes */]),
    filename: "speech.wav",
    mimeType: "audio/wav",
  },
  responseFormat: "verbose_json",
  timestampGranularities: ["segment", "word"],
});
```

All public operations return `Result` values from `better-result`; they do not throw on request, response, or parse failures.
