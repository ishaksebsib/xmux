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
    return Result.map(
      await Result.tryPromise({
        try: () => input.response.text(),
        catch: (cause) =>
          new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
      }),
      (text) => ({ text, raw: text, format: input.format }),
    );
  }

  const json = await Result.tryPromise({
    try: () => input.response.json() as Promise<unknown>,
    catch: (cause) => new SpeechToTextParseError({ url: input.url, format: input.format, cause }),
  });

  return Result.andThen(json, (value) => {
    if (!isRecord(value) || typeof value.text !== "string") {
      return Result.err(new SpeechToTextParseError({ url: input.url, format: input.format }));
    }

    return Result.ok({
      text: value.text,
      language: getString(value.language),
      duration: getNumber(value.duration),
      segments: toSegments(value.segments),
      words: toWords(value.words),
      raw: value,
      format: input.format,
    });
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
