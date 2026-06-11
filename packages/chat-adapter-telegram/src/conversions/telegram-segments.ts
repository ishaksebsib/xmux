import type { MessageEntity } from "grammy/types";
import type { TelegramRenderedText } from "./markdown-entities";

export const TELEGRAM_TEXT_LIMIT = 4096;

export interface TelegramRenderedSegment extends TelegramRenderedText {
  readonly index: number;
}

export function splitTelegramRenderedText(
  rendered: TelegramRenderedText,
  limit = TELEGRAM_TEXT_LIMIT,
): readonly TelegramRenderedSegment[] {
  if (rendered.text.length === 0) {
    return [];
  }

  const segments: TelegramRenderedSegment[] = [];
  const splitContext = createSplitContext(rendered.text);
  let start = 0;

  while (start < rendered.text.length) {
    const end = chooseSplitEnd(splitContext, start, limit);
    segments.push({
      index: segments.length,
      text: rendered.text.slice(start, end),
      entities: clipEntities(rendered.entities, start, end),
    });
    start = end;
  }

  return segments;
}

interface SplitContext {
  readonly text: string;
  readonly graphemeBoundaries: readonly number[];
}

function createSplitContext(text: string): SplitContext {
  return { text, graphemeBoundaries: graphemeBoundaries(text) };
}

function chooseSplitEnd(context: SplitContext, start: number, limit: number): number {
  const hardEnd = Math.min(context.text.length, start + limit);
  if (hardEnd === context.text.length) {
    return hardEnd;
  }

  const preferred = findPreferredBoundary(context, start, hardEnd);
  if (preferred !== undefined) {
    return preferred;
  }

  return previousGraphemeBoundary(context, start, hardEnd);
}

function findPreferredBoundary(
  context: SplitContext,
  start: number,
  hardEnd: number,
): number | undefined {
  const candidates = [
    lastBoundaryAfter(context, "\n\n", start, hardEnd),
    lastBoundaryAfter(context, "\n", start, hardEnd),
    lastSentenceBoundary(context, start, hardEnd),
    lastBoundaryAfter(context, " ", start, hardEnd),
  ];

  return candidates.find((candidate) => candidate !== undefined && candidate > start);
}

function lastBoundaryAfter(
  context: SplitContext,
  needle: string,
  start: number,
  hardEnd: number,
): number | undefined {
  const found = context.text.lastIndexOf(needle, hardEnd - 1);
  if (found < start) {
    return undefined;
  }

  return previousGraphemeBoundary(context, start, found + needle.length);
}

function lastSentenceBoundary(
  context: SplitContext,
  start: number,
  hardEnd: number,
): number | undefined {
  for (let index = hardEnd - 1; index > start; index -= 1) {
    const char = context.text[index];
    const next = context.text[index + 1];
    if ((char === "." || char === "!" || char === "?") && (next === " " || next === "\n")) {
      return previousGraphemeBoundary(context, start, index + 1);
    }
  }

  return undefined;
}

function previousGraphemeBoundary(context: SplitContext, start: number, hardEnd: number): number {
  let low = 0;
  let high = context.graphemeBoundaries.length - 1;
  let best: number | undefined;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const boundary = context.graphemeBoundaries[middle];
    if (boundary === undefined || boundary > hardEnd) {
      high = middle - 1;
      continue;
    }

    if (boundary > start) {
      best = boundary;
    }
    low = middle + 1;
  }

  return best ?? avoidSurrogateSplit(context.text, start, hardEnd);
}

function graphemeBoundaries(text: string): readonly number[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const boundaries = [0];

  for (const segment of segmenter.segment(text)) {
    boundaries.push(segment.index + segment.segment.length);
  }

  return boundaries;
}

function avoidSurrogateSplit(text: string, start: number, hardEnd: number): number {
  if (hardEnd <= start + 1) {
    return hardEnd;
  }

  const previous = text.charCodeAt(hardEnd - 1);
  const next = text.charCodeAt(hardEnd);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return hardEnd - 1;
  }

  return hardEnd;
}

function clipEntities(
  entities: readonly MessageEntity[],
  start: number,
  end: number,
): readonly MessageEntity[] {
  return entities
    .map((entity) => clipEntity(entity, start, end))
    .filter((entity): entity is MessageEntity => entity !== undefined);
}

function clipEntity(entity: MessageEntity, start: number, end: number): MessageEntity | undefined {
  const entityStart = entity.offset;
  const entityEnd = entity.offset + entity.length;
  const clippedStart = Math.max(entityStart, start);
  const clippedEnd = Math.min(entityEnd, end);

  if (clippedEnd <= clippedStart) {
    return undefined;
  }

  return {
    ...entity,
    offset: clippedStart - start,
    length: clippedEnd - clippedStart,
  };
}
