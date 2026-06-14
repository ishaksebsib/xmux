import { Result } from "better-result";
import type { ChatTextStreamChunk } from "@xmux/chat-core";
import { DiscordFormattingError } from "../errors";
import type { DiscordAdapterOptions } from "../types";
import { formatDiscordText } from "./formatting";
import { discordContentLimit, encodeDiscordText } from "./outbound";

export type DiscordEditStreamErrorFactory<TError> = (args: {
  readonly reason?: string;
  readonly cause?: unknown;
}) => TError;

interface DiscordTextStreamInput<TError> {
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly initialFlushedText: string;
  readonly editIntervalMs: number;
  readonly signal?: AbortSignal;
  readonly flushText: (text: string) => Promise<void>;
  readonly createError: DiscordEditStreamErrorFactory<TError>;
}

export interface DiscordEditStreamInput<TError> {
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
  readonly initialFlushedText: string;
  readonly editIntervalMs: number;
  readonly signal?: AbortSignal;
  readonly edit: (content: string) => Promise<void>;
  readonly createError: DiscordEditStreamErrorFactory<TError>;
}

export interface DiscordSegmentedStreamInput<TError> {
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
  readonly initialFlushedText: string;
  readonly editIntervalMs: number;
  readonly signal?: AbortSignal;
  readonly reconcile: (segments: readonly string[]) => Promise<void>;
  readonly createError: DiscordEditStreamErrorFactory<TError>;
}

export function encodeDiscordStreamText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
}): Result<string, DiscordFormattingError> {
  return encodeDiscordText(args);
}

export function encodeDiscordStreamSegments(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
}): Result<readonly string[], DiscordFormattingError> {
  return Result.map(formatDiscordText(args), splitDiscordStreamText);
}

export function splitDiscordStreamText(text: string): readonly string[] {
  if (text.length === 0) return [];

  const segments: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = chooseDiscordStreamSplitEnd(text, start);
    segments.push(text.slice(start, end));
    start = end;
  }

  return segments;
}

export async function streamDiscordTextByEditing<TError>(
  args: DiscordEditStreamInput<TError>,
): Promise<Result<{ readonly text: string }, TError>> {
  return streamDiscordText({
    ...args,
    flushText: async (text) => {
      ensureDiscordStreamLengthOrThrow(text);
      const encoded = encodeDiscordStreamText({
        text,
        format: args.format,
        adapterOptions: args.adapterOptions,
      });
      if (encoded.isErr()) throw encoded.error;
      await args.edit(encoded.value);
    },
  });
}

export async function streamDiscordTextBySegments<TError>(
  args: DiscordSegmentedStreamInput<TError>,
): Promise<Result<{ readonly text: string }, TError>> {
  return streamDiscordText({
    ...args,
    flushText: async (text) => {
      const segments = encodeDiscordStreamSegments({
        text,
        format: args.format,
        adapterOptions: args.adapterOptions,
      });
      if (segments.isErr()) throw segments.error;
      await args.reconcile(segments.value);
    },
  });
}

function streamDiscordText<TError>(
  args: DiscordTextStreamInput<TError>,
): Promise<Result<{ readonly text: string }, TError>> {
  return Result.tryPromise({
    try: () => runDiscordTextStream(args),
    catch: (cause) =>
      args.createError({
        reason: isAbortError(args.signal, cause) ? "Discord stream was aborted" : undefined,
        cause,
      }),
  });
}

async function runDiscordTextStream<TError>(
  args: DiscordTextStreamInput<TError>,
): Promise<{ readonly text: string }> {
  const iterator = args.chunks[Symbol.asyncIterator]();
  let text = "";
  let flushedText = args.initialFlushedText;
  let dirty = false;
  let lastFlushAt = Date.now();
  let timer: StreamTimer | undefined;
  let next = readNext(iterator);
  const abortSignal = createAbortSignalPromise(args.signal);

  const cancelTimer = () => {
    timer?.cancel();
    timer = undefined;
  };

  const scheduleTimer = () => {
    if (!dirty || timer !== undefined) return;
    timer = createStreamTimer(
      Math.max(0, args.editIntervalMs - (Date.now() - lastFlushAt)),
      args.signal,
    );
  };

  const flush = async (force: boolean) => {
    cancelTimer();
    if (!force && (!dirty || text === flushedText)) return;

    await args.flushText(text);
    flushedText = text;
    dirty = false;
    lastFlushAt = Date.now();
  };

  try {
    scheduleTimer();
    while (true) {
      throwIfAborted(args.signal);
      const event = await (timer === undefined
        ? Promise.race([next, abortSignal.promise])
        : Promise.race([next, timer.promise, abortSignal.promise]));

      if (event.type === "timer") {
        timer = undefined;
        await flush(false);
        continue;
      }

      if (event.result.done === true) {
        break;
      }

      text = applyDiscordStreamChunk(text, event.result.value);
      dirty = true;

      if (event.result.value.type === "completed") {
        break;
      }

      next = readNext(iterator);
      scheduleTimer();
    }

    await flush(true);
    return { text };
  } finally {
    cancelTimer();
    abortSignal.cancel();
    void iterator.return?.();
  }
}

export function applyDiscordStreamChunk(text: string, chunk: ChatTextStreamChunk): string {
  if (chunk.type === "delta") {
    return text + chunk.delta;
  }

  if (chunk.type === "snapshot") {
    return chunk.text;
  }

  return chunk.text ?? text;
}

export function ensureDiscordStreamLength(text: string): Result<void, DiscordFormattingError> {
  return text.length > discordContentLimit
    ? Result.err(
        new DiscordFormattingError({
          reason: `Discord message content exceeds ${discordContentLimit} characters`,
        }),
      )
    : Result.ok();
}

function ensureDiscordStreamLengthOrThrow(text: string): void {
  const result = ensureDiscordStreamLength(text);
  if (result.isErr()) throw result.error;
}

function chooseDiscordStreamSplitEnd(text: string, start: number): number {
  const hardEnd = Math.min(text.length, start + discordContentLimit);
  if (hardEnd === text.length) return hardEnd;

  const preferred = lastPreferredSplit(text, start, hardEnd);
  return avoidDanglingEscape(text, start, avoidSurrogateSplit(text, start, preferred ?? hardEnd));
}

function lastPreferredSplit(text: string, start: number, hardEnd: number): number | undefined {
  for (const separator of ["\n\n", "\n", " "]) {
    const index = text.lastIndexOf(separator, hardEnd - 1);
    if (index > start) return index + separator.length;
  }

  return undefined;
}

function avoidSurrogateSplit(text: string, start: number, end: number): number {
  if (end <= start + 1) return end;

  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? end - 1
    : end;
}

function avoidDanglingEscape(text: string, start: number, end: number): number {
  if (end >= text.length || end <= start + 1 || text[end - 1] !== "\\") return end;

  let slashCount = 0;
  for (let index = end - 1; index >= start && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1 ? end - 1 : end;
}

function readNext(iterator: AsyncIterator<ChatTextStreamChunk>) {
  return iterator.next().then((result) => ({ type: "next" as const, result }));
}

interface StreamTimer {
  readonly promise: Promise<{ readonly type: "timer" }>;
  cancel(): void;
}

interface AbortSignalPromise {
  readonly promise: Promise<never>;
  cancel(): void;
}

function createAbortSignalPromise(signal: AbortSignal | undefined): AbortSignalPromise {
  let removeAbortListener: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal === undefined) return;
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Stream aborted"));
      return;
    }

    const abort = () => reject(signal.reason ?? new Error("Stream aborted"));
    signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", abort);
  });

  return {
    promise,
    cancel() {
      removeAbortListener?.();
    },
  };
}

function createStreamTimer(delayMs: number, signal: AbortSignal | undefined): StreamTimer {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const promise = new Promise<{ readonly type: "timer" }>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error("Stream aborted"));
      return;
    }

    const abort = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Stream aborted"));
    };

    signal?.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal?.removeEventListener("abort", abort);

    timeout = setTimeout(() => {
      removeAbortListener?.();
      resolve({ type: "timer" });
    }, delayMs);
  });

  return {
    promise,
    cancel() {
      if (timeout !== undefined) clearTimeout(timeout);
      removeAbortListener?.();
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Stream aborted");
  }
}

function isAbortError(signal: AbortSignal | undefined, cause: unknown): boolean {
  return signal?.aborted === true && (cause === signal.reason || signal.reason === undefined);
}
