import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextFileReadError } from "./errors";
import type { SpeechToTextAudioInput } from "./types";

export type CreateSpeechToTextAudioInput = {
  readonly path: string;
  readonly filename?: string;
  readonly mimeType?: string;
};

export type SpeechToTextAudioFromFileInput = string | CreateSpeechToTextAudioInput;

export async function createSpeechToTextAudioFromFile(
  input: SpeechToTextAudioFromFileInput,
): Promise<ResultType<SpeechToTextAudioInput, SpeechToTextFileReadError>> {
  const normalized = typeof input === "string" ? { path: input } : input;
  const audio = await Result.tryPromise({
    try: () => readFile(normalized.path),
    catch: (cause) => new SpeechToTextFileReadError({ path: normalized.path, cause }),
  });

  return audio.isOk()
    ? Result.ok({
        source: "bytes",
        data: audio.value,
        filename: normalized.filename ?? basename(normalized.path),
        mimeType: normalized.mimeType,
      })
    : Result.err(audio.error);
}

export const audioFromFile = createSpeechToTextAudioFromFile;
