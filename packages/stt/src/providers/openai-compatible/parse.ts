import { Result, type Result as ResultType } from "better-result";
import { SpeechToTextParseError } from "../../errors";
import type {
  SpeechToTextResponseFormat,
  SpeechToTextSegment,
  SpeechToTextTranscript,
  SpeechToTextWord,
} from "../../types";

export async function parseTranscriptionResponse(input: {
  readonly response: Response;
  readonly format: SpeechToTextResponseFormat;
  readonly url: string;
}): Promise<ResultType<SpeechToTextTranscript, SpeechToTextParseError>> {
  if (input.format === "text" || input.format === "srt" || input.format === "vtt") {
    const text = await Result.tryPromise({
      try: () => input.response.text(),
      catch: (cause) => new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
    });

    return text.isOk()
      ? Result.ok({ text: text.value, raw: text.value, format: input.format })
      : Result.err(text.error);
  }

  const json = await Result.tryPromise({
    try: () => input.response.json() as Promise<unknown>,
    catch: (cause) => new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
  });

  if (json.isErr()) return Result.err(json.error);
  if (!isRecord(json.value) || typeof json.value.text !== "string") {
    return Result.err(new SpeechToTextParseError({ url: input.url, format: input.format }));
  }

  return Result.ok({
    text: json.value.text,
    language: getString(json.value.language),
    duration: getNumber(json.value.duration),
    segments: toSegments(json.value.segments),
    words: toWords(json.value.words),
    raw: json.value,
    format: input.format,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toSegments(value: unknown): readonly SpeechToTextSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((segment): SpeechToTextSegment[] => {
    if (!isRecord(segment) || typeof segment.text !== "string") return [];

    return [
      {
        id: getNumber(segment.id),
        start: getNumber(segment.start),
        end: getNumber(segment.end),
        text: segment.text,
      },
    ];
  });
}

function toWords(value: unknown): readonly SpeechToTextWord[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((word): SpeechToTextWord[] => {
    if (!isRecord(word) || typeof word.word !== "string") return [];

    return [
      {
        start: getNumber(word.start),
        end: getNumber(word.end),
        word: word.word,
      },
    ];
  });
}
