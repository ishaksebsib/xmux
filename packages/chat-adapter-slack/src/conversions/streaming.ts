import { Result } from "better-result";
import type { ChatMessageFormat, ChatSentMessage, ChatTextStreamChunk } from "@xmux/chat-core";
import type { SlackBotClient, SlackNativeStreamChunk, SlackSentMessage } from "../client";
import { slackStreamMarkdownTextLimit, type SlackAdapterConfig } from "../config";
import { SlackFormattingError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";
import { escapeSlackText, stripSlackHtml } from "./formatting";
import { encodeSlackSentMessage } from "./outbound";

export type SlackNativeStreamErrorFactory<TError> = (args: {
  readonly reason?: string;
  readonly cause?: unknown;
}) => TError;

export interface SlackNativeStreamResolvedConfig {
  readonly bufferSize: number;
  readonly maxSegmentChars: number;
}

export interface SlackNativeStreamTarget {
  readonly channel: string;
  readonly threadTs: string;
  readonly recipientTeamId?: string;
  readonly recipientUserId?: string;
  readonly taskDisplayMode?: string;
}

export interface SlackNativeStreamResult {
  readonly text: string;
  readonly slackMessages: readonly SlackSentMessage[];
}

export interface SlackNativeStreamInput<TError> {
  readonly client: Pick<SlackBotClient, "startStream" | "appendStream" | "stopStream">;
  readonly target: SlackNativeStreamTarget;
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly format?: ChatMessageFormat;
  readonly adapterOptions: SlackAdapterOptions;
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly signal?: AbortSignal;
  readonly createError: SlackNativeStreamErrorFactory<TError>;
}

export function resolveSlackNativeStreamConfig(args: {
  readonly config: Pick<SlackAdapterConfig, "stream">;
  readonly adapterOptions: SlackAdapterOptions;
}): Result<SlackNativeStreamResolvedConfig, SlackFormattingError> {
  return Result.gen(function* () {
    yield* validateSlackNativeStreamAdapterOptions(args.adapterOptions);

    const bufferSize = args.adapterOptions.stream?.bufferSize ?? args.config.stream.bufferSize;
    const maxSegmentChars =
      args.adapterOptions.stream?.maxSegmentChars ?? args.config.stream.maxSegmentChars;

    yield* validatePositiveStreamInteger({
      field: "adapterOptions.stream.bufferSize",
      value: bufferSize,
      limit: slackStreamMarkdownTextLimit,
    });
    yield* validatePositiveStreamInteger({
      field: "adapterOptions.stream.maxSegmentChars",
      value: maxSegmentChars,
      limit: slackStreamMarkdownTextLimit,
    });

    return Result.ok({ bufferSize, maxSegmentChars });
  });
}

export function appendSlackNativeStreamChunk(args: {
  readonly currentText: string;
  readonly chunk: ChatTextStreamChunk;
}): Result<{ readonly text: string; readonly delta: string }, SlackFormattingError> {
  if (args.chunk.type === "delta") {
    return Result.ok({
      text: args.currentText + args.chunk.delta,
      delta: args.chunk.delta,
    });
  }

  if (args.chunk.text === undefined) {
    return Result.ok({ text: args.currentText, delta: "" });
  }

  if (!args.chunk.text.startsWith(args.currentText)) {
    return Result.err(
      new SlackFormattingError({
        reason: "Slack native streaming is append-only and cannot apply non-prefix snapshot chunks",
      }),
    );
  }

  return Result.ok({
    text: args.chunk.text,
    delta: args.chunk.text.slice(args.currentText.length),
  });
}

export function encodeSlackNativeStreamText(args: {
  readonly text: string;
  readonly format?: ChatMessageFormat;
}): Result<string, SlackFormattingError> {
  switch (args.format) {
    case undefined:
    case "plain":
      return Result.ok(escapeSlackPlainMarkdownText(args.text));
    case "markdown":
      return Result.ok(args.text);
    case "html":
      return Result.ok(escapeSlackMarkdownControlCharacters(stripSlackHtml(args.text)));
  }
}

export function splitSlackNativeStreamText(
  text: string,
  limit = slackStreamMarkdownTextLimit,
): readonly string[] {
  if (text.length === 0) return [];

  const segments: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = chooseSlackStreamSplitEnd(text, start, limit);
    segments.push(text.slice(start, end));
    start = end;
  }

  return segments;
}

export async function streamSlackNativeText<TError>(
  args: SlackNativeStreamInput<TError>,
): Promise<Result<SlackNativeStreamResult, TError>> {
  return Result.tryPromise({
    try: () => runSlackNativeTextStream(args),
    catch: (cause) =>
      args.createError({
        reason: isAbortError(args.signal, cause) ? "Slack native stream was aborted" : undefined,
        cause,
      }),
  });
}

export function encodeSlackStreamedMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly conversationId: string;
  readonly text: string;
  readonly format?: ChatMessageFormat;
  readonly threadTs: string;
  readonly slackMessages: readonly SlackSentMessage[];
}): ChatSentMessage<TChatId, SlackAdapterData> {
  const lastMessage = args.slackMessages.at(-1);
  if (lastMessage === undefined) {
    throw new Error("Slack native stream did not finalize any messages");
  }

  return encodeSlackSentMessage({
    chatId: args.chatId,
    text: args.text,
    format: args.format,
    slackMessage: {
      ...lastMessage,
      threadTs: lastMessage.threadTs ?? args.threadTs,
      raw: args.slackMessages.map((message) => message.raw),
    },
  });
}

async function runSlackNativeTextStream<TError>(
  args: SlackNativeStreamInput<TError>,
): Promise<SlackNativeStreamResult> {
  const resolved = resolveSlackNativeStreamConfig({
    config: args.config,
    adapterOptions: args.adapterOptions,
  });
  if (resolved.isErr()) throw resolved.error;

  const writer = new SlackNativeStreamWriter({
    client: args.client,
    target: args.target,
    adapterOptions: args.adapterOptions,
    bufferSize: resolved.value.bufferSize,
    maxSegmentChars: resolved.value.maxSegmentChars,
    signal: args.signal,
  });
  let text = "";

  try {
    for await (const chunk of args.chunks) {
      throwIfAborted(args.signal);
      const applied = appendSlackNativeStreamChunk({ currentText: text, chunk });
      if (applied.isErr()) throw applied.error;

      text = applied.value.text;
      if (applied.value.delta.length > 0) {
        const encoded = encodeSlackNativeStreamText({
          text: applied.value.delta,
          format: args.format,
        });
        if (encoded.isErr()) throw encoded.error;
        await writer.write(encoded.value);
      }

      if (chunk.type === "completed") {
        break;
      }
    }

    if (text.length === 0 && args.config.stream.emptyText.length > 0) {
      text = args.config.stream.emptyText;
      const encoded = encodeSlackNativeStreamText({
        text,
        format: args.format,
      });
      if (encoded.isErr()) throw encoded.error;
      await writer.write(encoded.value);
    }

    const slackMessages = await writer.finish();
    return { text, slackMessages };
  } catch (cause) {
    await writer.stopOpenStreamBestEffort();
    throw cause;
  }
}

class SlackNativeStreamWriter {
  private buffer = "";
  private current: SlackSentMessage | undefined;
  private currentSegmentChars = 0;
  private readonly stoppedMessages: SlackSentMessage[] = [];

  constructor(
    private readonly args: {
      readonly client: Pick<SlackBotClient, "startStream" | "appendStream" | "stopStream">;
      readonly target: SlackNativeStreamTarget;
      readonly adapterOptions: SlackAdapterOptions;
      readonly bufferSize: number;
      readonly maxSegmentChars: number;
      readonly signal?: AbortSignal;
    },
  ) {}

  async write(text: string): Promise<void> {
    if (text.length === 0) return;

    this.buffer += text;
    if (this.buffer.length >= this.args.bufferSize) {
      await this.flush();
    }
  }

  async finish(): Promise<readonly SlackSentMessage[]> {
    await this.flush();

    if (this.current === undefined) {
      throw new Error("Slack native stream produced no text");
    }

    await this.stopCurrent({ final: true });
    return [...this.stoppedMessages];
  }

  async stopOpenStreamBestEffort(): Promise<void> {
    if (this.current === undefined) return;

    const current = this.current;
    try {
      const stopped = await this.args.client.stopStream({
        channel: current.channelId,
        ts: current.messageTs,
        thread_ts: this.args.target.threadTs,
      });
      this.stoppedMessages.push(stopped);
      this.current = undefined;
      this.currentSegmentChars = 0;
    } catch {
      // Preserve the original stream failure. This best-effort stop only prevents an open Slack stream.
    }
  }

  private async flush(): Promise<void> {
    while (this.buffer.length > 0) {
      throwIfAborted(this.args.signal);

      if (this.currentSegmentChars >= this.args.maxSegmentChars) {
        await this.stopCurrent({ final: false });
      }

      const remainingInSegment = this.args.maxSegmentChars - this.currentSegmentChars;
      const hardLimit = Math.min(
        this.buffer.length,
        remainingInSegment,
        slackStreamMarkdownTextLimit,
      );
      const end = chooseSlackStreamSplitEnd(this.buffer, 0, hardLimit);
      if (end > remainingInSegment && this.currentSegmentChars > 0) {
        await this.stopCurrent({ final: false });
        continue;
      }

      const text = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      await this.send(text);
    }
  }

  private async send(text: string): Promise<void> {
    if (text.length === 0) return;

    throwIfAborted(this.args.signal);
    const chunks = [markdownTextChunk(text)];

    if (this.current === undefined) {
      this.current = await this.args.client.startStream({
        channel: this.args.target.channel,
        thread_ts: this.args.target.threadTs,
        chunks,
        recipient_team_id: this.args.target.recipientTeamId,
        recipient_user_id: this.args.target.recipientUserId,
        task_display_mode: this.args.target.taskDisplayMode,
        signal: this.args.signal,
      });
    } else {
      await this.args.client.appendStream({
        channel: this.current.channelId,
        ts: this.current.messageTs,
        chunks,
        signal: this.args.signal,
      });
    }

    this.currentSegmentChars += text.length;
  }

  private async stopCurrent(args: { readonly final: boolean }): Promise<void> {
    if (this.current === undefined) return;

    throwIfAborted(this.args.signal);
    const current = this.current;
    const stopped = await this.args.client.stopStream({
      channel: current.channelId,
      ts: current.messageTs,
      thread_ts: this.args.target.threadTs,
      blocks: args.final ? this.args.adapterOptions.blocks : undefined,
      metadata: args.final ? this.args.adapterOptions.metadata : undefined,
      signal: this.args.signal,
    });

    this.stoppedMessages.push(stopped);
    this.current = undefined;
    this.currentSegmentChars = 0;
  }
}

function validateSlackNativeStreamAdapterOptions(
  adapterOptions: SlackAdapterOptions,
): Result<void, SlackFormattingError> {
  if (adapterOptions.ephemeral === true) {
    return Result.err(
      new SlackFormattingError({
        reason: "Slack native streaming does not support ephemeral messages",
      }),
    );
  }

  if (adapterOptions.replyBroadcast !== undefined) {
    return Result.err(
      new SlackFormattingError({
        reason: "Slack native streaming does not support replyBroadcast",
      }),
    );
  }

  if (adapterOptions.unfurl_links !== undefined || adapterOptions.unfurl_media !== undefined) {
    return Result.err(
      new SlackFormattingError({
        reason: "Slack native streaming does not support unfurl options",
      }),
    );
  }

  return Result.ok();
}

function validatePositiveStreamInteger(args: {
  readonly field: string;
  readonly value: number;
  readonly limit: number;
}): Result<void, SlackFormattingError> {
  if (!Number.isFinite(args.value) || !Number.isInteger(args.value) || args.value <= 0) {
    return Result.err(
      new SlackFormattingError({
        reason: `${args.field} must be a positive integer`,
      }),
    );
  }

  return args.value > args.limit
    ? Result.err(
        new SlackFormattingError({
          reason: `${args.field} must not exceed ${args.limit} characters`,
        }),
      )
    : Result.ok();
}

function markdownTextChunk(text: string): SlackNativeStreamChunk {
  return { type: "markdown_text", text };
}

function escapeSlackPlainMarkdownText(text: string): string {
  return escapeSlackMarkdownControlCharacters(escapeSlackText(text));
}

function escapeSlackMarkdownControlCharacters(text: string): string {
  return text.replace(/([\\*_~`[\]()#])/g, "\\$1");
}

function chooseSlackStreamSplitEnd(text: string, start: number, limit: number): number {
  const hardEnd = Math.min(text.length, start + limit);
  if (hardEnd >= text.length) return text.length;

  return (
    findPreferredBoundary(text, start, hardEnd) ?? previousGraphemeBoundary(text, start, hardEnd)
  );
}

function findPreferredBoundary(text: string, start: number, hardEnd: number): number | undefined {
  const candidates = [
    lastBoundaryAfter(text, "\n\n", start, hardEnd),
    lastBoundaryAfter(text, "\n", start, hardEnd),
    lastSentenceBoundary(text, start, hardEnd),
    lastBoundaryAfter(text, " ", start, hardEnd),
  ];

  return candidates.find((candidate) => candidate !== undefined && candidate > start);
}

function lastBoundaryAfter(
  text: string,
  needle: string,
  start: number,
  hardEnd: number,
): number | undefined {
  const found = text.lastIndexOf(needle, hardEnd - 1);
  return found < start ? undefined : previousGraphemeBoundary(text, start, found + needle.length);
}

function lastSentenceBoundary(text: string, start: number, hardEnd: number): number | undefined {
  for (let index = hardEnd - 1; index > start; index -= 1) {
    const char = text[index];
    const next = text[index + 1];
    if ((char === "." || char === "!" || char === "?") && (next === " " || next === "\n")) {
      return previousGraphemeBoundary(text, start, index + 1);
    }
  }

  return undefined;
}

function previousGraphemeBoundary(text: string, start: number, hardEnd: number): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let best: number | undefined;
  let nextAfterStart: number | undefined;

  for (const segment of segmenter.segment(text)) {
    const boundary = segment.index + segment.segment.length;
    if (boundary > start && nextAfterStart === undefined) {
      nextAfterStart = boundary;
    }
    if (boundary > hardEnd) break;
    if (boundary > start) best = boundary;
  }

  return best ?? nextAfterStart ?? avoidSurrogateSplit(text, start, hardEnd);
}

function avoidSurrogateSplit(text: string, start: number, hardEnd: number): number {
  if (hardEnd <= start + 1) return hardEnd;

  const previous = text.charCodeAt(hardEnd - 1);
  const next = text.charCodeAt(hardEnd);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? hardEnd - 1
    : hardEnd;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Slack native stream aborted");
  }
}

function isAbortError(signal: AbortSignal | undefined, cause: unknown): boolean {
  return signal?.aborted === true && (signal.reason === undefined || cause === signal.reason);
}
