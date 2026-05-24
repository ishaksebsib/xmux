import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  SpeechToTextConfigError,
  SpeechToTextParseError,
  SpeechToTextRequestError,
  SpeechToTextResponseError,
  createSpeechToTextAudioFromFile,
  createSpeechToTextClient,
} from "../src";

type FetchCall = {
  readonly url: string;
  readonly init?: RequestInit;
};

function createAudioInput() {
  return {
    source: "bytes",
    data: new Uint8Array([1, 2, 3]),
    filename: "speech.wav",
    mimeType: "audio/wav",
  } as const;
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function createFetch(response: Response): {
  readonly calls: FetchCall[];
  readonly fetch: typeof fetch;
} {
  const calls: FetchCall[] = [];

  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return response;
    },
  };
}

function requireFormData(call: FetchCall): FormData {
  expect(call.init?.body).toBeInstanceOf(FormData);
  return call.init?.body as FormData;
}

describe("createSpeechToTextClient", () => {
  test("sends OpenAI-compatible multipart transcription requests", async () => {
    const transport = createFetch(
      createJsonResponse({
        text: "hello world",
        language: "en",
        duration: 1.5,
        segments: [{ id: 1, start: 0, end: 1.5, text: "hello world" }],
        words: [{ start: 0, end: 0.5, word: "hello" }],
      }),
    );
    const client = createSpeechToTextClient({
      provider: "openai-compatible",
      apiKey: "test-key",
      model: "gpt-4o-transcribe",
      organization: "org-1",
      project: "project-1",
      headers: { "x-provider": "openai" },
      fetch: transport.fetch,
    });

    const result = await client.transcribe({
      audio: createAudioInput(),
      language: "en",
      prompt: "technical terms",
      temperature: 0,
      responseFormat: "verbose_json",
      timestampGranularities: ["segment", "word"],
      extraBody: { chunking_strategy: "auto" },
      headers: { "x-request-id": "request-1" },
    });

    expect(result.isOk()).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");

    const headers = new Headers(transport.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("openai-organization")).toBe("org-1");
    expect(headers.get("openai-project")).toBe("project-1");
    expect(headers.get("x-provider")).toBe("openai");
    expect(headers.get("x-request-id")).toBe("request-1");

    const form = requireFormData(transport.calls[0] as FetchCall);
    expect(form.get("model")).toBe("gpt-4o-transcribe");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("technical terms");
    expect(form.get("temperature")).toBe("0");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["segment", "word"]);
    expect(form.get("chunking_strategy")).toBe("auto");
    expect(form.get("file")).toBeInstanceOf(Blob);

    if (result.isOk()) {
      expect(result.value).toMatchObject({
        text: "hello world",
        language: "en",
        duration: 1.5,
        format: "verbose_json",
        segments: [{ id: 1, start: 0, end: 1.5, text: "hello world" }],
        words: [{ start: 0, end: 0.5, word: "hello" }],
      });
    }
  });

  test("supports local OpenAI-compatible servers without API keys", async () => {
    const transport = createFetch(createJsonResponse({ text: "local transcript" }));
    const client = createSpeechToTextClient({
      baseUrl: "http://127.0.0.1:1234/v1",
      endpointPath: "audio/transcriptions",
      model: "whisper-local",
      fetch: transport.fetch,
    });

    const result = await client.transcribe({ audio: createAudioInput() });

    expect(result.isOk()).toBe(true);
    expect(transport.calls[0]?.url).toBe("http://127.0.0.1:1234/v1/audio/transcriptions");
    expect(new Headers(transport.calls[0]?.init?.headers).has("authorization")).toBe(false);
  });

  test("parses text-like transcription responses", async () => {
    const transport = createFetch(new Response("plain transcript"));
    const client = createSpeechToTextClient({ model: "whisper-1", fetch: transport.fetch });

    const result = await client.transcribe({
      audio: createAudioInput(),
      responseFormat: "text",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        text: "plain transcript",
        raw: "plain transcript",
        format: "text",
      });
    }
  });

  test("returns typed response errors for non-2xx provider responses", async () => {
    const transport = createFetch(createJsonResponse({ error: "bad model" }, { status: 400 }));
    const client = createSpeechToTextClient({ model: "missing", fetch: transport.fetch });

    const result = await client.transcribe({ audio: createAudioInput() });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(SpeechToTextResponseError);
      expect(result.error.message).toContain("status 400");
      expect(result.error.message).toContain("bad model");
    }
  });

  test("returns typed request errors for fetch failures", async () => {
    const client = createSpeechToTextClient({
      model: "whisper-1",
      fetch: async () => {
        throw new Error("network down");
      },
    });

    const result = await client.transcribe({ audio: createAudioInput() });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(SpeechToTextRequestError);
      expect(result.error.message).toContain("network down");
    }
  });

  test("returns parse errors for malformed JSON responses", async () => {
    const transport = createFetch(createJsonResponse({ language: "en" }));
    const client = createSpeechToTextClient({ model: "whisper-1", fetch: transport.fetch });

    const result = await client.transcribe({ audio: createAudioInput() });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(SpeechToTextParseError);
    }
  });

  test("validates required configuration before sending requests", async () => {
    const transport = createFetch(createJsonResponse({ text: "unused" }));
    const client = createSpeechToTextClient({ model: "", fetch: transport.fetch });

    const result = await client.transcribe({ audio: createAudioInput() });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(SpeechToTextConfigError);
    }
    expect(transport.calls).toHaveLength(0);
  });
});

describe("createSpeechToTextAudioFromFile", () => {
  test("creates byte audio inputs from local files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xmux-stt-"));
    const path = join(directory, "sample.wav");
    await writeFile(path, Buffer.from([1, 2, 3]));

    const result = await createSpeechToTextAudioFromFile({ path, mimeType: "audio/wav" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        source: "bytes",
        filename: "sample.wav",
        mimeType: "audio/wav",
      });
      expect(result.value.data).toBeInstanceOf(Uint8Array);
    }
  });
});
