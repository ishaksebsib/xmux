import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextFileReadError } from "./errors";
import type { SpeechToTextAudioInput } from "./contracts";

export type CreateSpeechToTextAudioInput = {
  readonly path: string;
  readonly filename?: string;
  readonly mimeType?: string;
};

export async function createSpeechToTextAudioFromFile(
  input: CreateSpeechToTextAudioInput,
): Promise<ResultType<SpeechToTextAudioInput, SpeechToTextFileReadError>> {
  const audio = await Result.tryPromise({
    try: () => readFile(input.path),
    catch: (cause) => new SpeechToTextFileReadError({ path: input.path, cause }),
  });

  return audio.isOk()
    ? Result.ok({
        source: "bytes",
        data: audio.value,
        filename: input.filename ?? basename(input.path),
        mimeType: input.mimeType,
      })
    : Result.err(audio.error);
}
