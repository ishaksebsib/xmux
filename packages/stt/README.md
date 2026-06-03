# @xmux/stt

Speech-to-text SDK for OpenAI-compatible transcription APIs.

The main entry is runtime-neutral. Node-only file helpers live under `@xmux/stt/node`.

## Install

```sh
pnpm add @xmux/stt
```

## OpenAI

```ts
import { createSttClient } from "@xmux/stt";
import { audioFromFile } from "@xmux/stt/node";

const client = createSttClient({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-transcribe",
});

if (client.isErr()) throw client.error;

const audio = await audioFromFile({
  path: "./audio.wav",
  mimeType: "audio/wav",
});

if (audio.isErr()) throw audio.error;

const transcript = await client.value.transcribe({
  audio: audio.value,
  language: "en",
});

if (transcript.isErr()) throw transcript.error;

console.log(transcript.value.text);
```

## Local Compatible API

Use the same client with local OpenAI-compatible servers such as LM Studio, Ollama gateways, or other proxy runtimes.

```ts
import { createSpeechToTextClient } from "@xmux/stt";
import { createSpeechToTextAudioFromFile } from "@xmux/stt/node";

const client = createSpeechToTextClient({
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "whisper-local",
});

if (client.isOk()) {
  const audio = await createSpeechToTextAudioFromFile("./audio.mp3");

  if (audio.isOk()) {
    const transcript = await client.value.transcribe({ audio: audio.value });
    if (transcript.isOk()) console.log(transcript.value.text);
  }
}
```

## Bytes Or Blob Input

```ts
const transcript = await client.value.transcribe({
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

All public operations return `Result` values from `better-result`; they do not throw on configuration, input, request, response, or parse failures.
