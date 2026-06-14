import { Result } from "better-result";
import type { ChatTextStreamChunk } from "@xmux/chat-core";
import { DiscordFormattingError } from "../errors";
import type { DiscordAdapterOptions } from "../types";
import { discordContentLimit, encodeDiscordText } from "./outbound";

export type DiscordEditStreamErrorFactory<TError> = (args: {
  readonly reason?: string;
  readonly cause?: unknown;
}) => TError;

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

export function encodeDiscordStreamText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: DiscordAdapterOptions;
}): Result<string, DiscordFormattingError> {
  return encodeDiscordText(args);
}

export async function streamDiscordTextByEditing<TError>(
  args: DiscordEditStreamInput<TError>,
): Promise<Result<{ readonly text: string }, TError>> {
  return Result.tryPromise({
    try: () => runDiscordEditStream(args),
    catch: (cause) =>
      args.createError({
        reason: isAbortError(args.signal, cause) ? "Discord stream was aborted" : undefined,
        cause,
      }),
  });
}

async function runDiscordEditStream<TError>(
  args: DiscordEditStreamInput<TError>,
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

    const encoded = encodeDiscordStreamText({
      text,
      format: args.format,
      adapterOptions: args.adapterOptions,
    });
    if (encoded.isErr()) {
      throw encoded.error;
    }

    await args.edit(encoded.value);
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
      ensureDiscordStreamLengthOrThrow(text);
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
