import { Result } from "better-result";
import type { InputRichMessage, Message } from "grammy/types";
import type { TelegramBotClient } from "../client";
import type { TelegramRichStreamMessageRequest } from "../conversions/streaming";

export const TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT = 32_768;
export const TELEGRAM_DRAFT_HEARTBEAT_INTERVAL_MS = 4_000;

export interface TelegramRichStreamResult {
  readonly text: string;
  readonly format: "markdown" | "html";
  readonly telegramMessages: Message.RichMessageMessage[];
}

export function streamTelegramRich<TError>(args: {
  readonly bot: TelegramBotClient;
  readonly request: TelegramRichStreamMessageRequest;
  readonly signal?: AbortSignal;
  readonly createError: (cause: unknown) => TError;
  readonly heartbeatIntervalMs?: number;
}): Promise<Result<TelegramRichStreamResult, TError>> {
  return Result.tryPromise({
    try: () => runTelegramRichStream(args),
    catch: args.createError,
  });
}

export function splitTelegramRichText(text: string): readonly string[] {
  if (text.length === 0) return [""];
  const segments: string[] = [];
  let remaining = text;

  while (countCodePoints(remaining) > TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT) {
    const splitIndex = chooseSplitIndex(remaining, TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT);
    segments.push(sliceCodePoints(remaining, 0, splitIndex));
    remaining = sliceCodePoints(remaining, splitIndex);
  }

  segments.push(remaining);
  return segments;
}

async function runTelegramRichStream<TError>(args: {
  readonly bot: TelegramBotClient;
  readonly request: TelegramRichStreamMessageRequest;
  readonly signal?: AbortSignal;
  readonly createError: (cause: unknown) => TError;
  readonly heartbeatIntervalMs?: number;
}): Promise<TelegramRichStreamResult> {
  let fullText = "";
  let segmentText = "";
  let segmentIndex = 0;
  const telegramMessages: Message.RichMessageMessage[] = [];
  const scheduler = new RichDraftScheduler({
    bot: args.bot,
    request: args.request,
    signal: args.signal,
    heartbeatIntervalMs: args.heartbeatIntervalMs ?? TELEGRAM_DRAFT_HEARTBEAT_INTERVAL_MS,
  });

  try {
    for await (const delta of args.request.stream) {
      fullText += delta;
      let remaining = delta;
      while (remaining.length > 0) {
        const available = TELEGRAM_RICH_MESSAGE_CHARACTER_LIMIT - countCodePoints(segmentText);
        if (available <= 0) {
          await scheduler.flush();
          telegramMessages.push(
            await sendFinalSegment(args, segmentText, telegramMessages.length === 0),
          );
          segmentIndex += 1;
          segmentText = "";
          scheduler.setSegmentIndex(segmentIndex);
          continue;
        }

        if (countCodePoints(remaining) <= available) {
          segmentText += remaining;
          remaining = "";
          scheduler.schedule(segmentText);
          continue;
        }

        const splitIndex = chooseSplitIndex(remaining, available);
        const piece = sliceCodePoints(remaining, 0, splitIndex);
        segmentText += piece;
        remaining = sliceCodePoints(remaining, splitIndex);
        scheduler.schedule(segmentText);
        await scheduler.flush();
        telegramMessages.push(
          await sendFinalSegment(args, segmentText, telegramMessages.length === 0),
        );
        segmentIndex += 1;
        segmentText = "";
        scheduler.setSegmentIndex(segmentIndex);
      }
    }

    await scheduler.flush();
    telegramMessages.push(await sendFinalSegment(args, segmentText, telegramMessages.length === 0));
    return { text: fullText, format: args.request.format, telegramMessages };
  } finally {
    await scheduler.stop();
  }
}

class RichDraftScheduler {
  private latestText = "";
  private inFlight: Promise<void> | undefined;
  private failedText: string | undefined;
  private segmentIndex = 0;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private readonly args: {
      readonly bot: TelegramBotClient;
      readonly request: TelegramRichStreamMessageRequest;
      readonly signal?: AbortSignal;
      readonly heartbeatIntervalMs: number;
    },
  ) {
    this.heartbeat = setInterval(() => this.sendEligible(), args.heartbeatIntervalMs);
  }

  setSegmentIndex(segmentIndex: number): void {
    this.segmentIndex = segmentIndex;
    this.latestText = "";
    this.failedText = undefined;
  }

  schedule(text: string): void {
    this.latestText = text;
    if (this.failedText !== text) this.sendEligible();
  }

  async flush(): Promise<void> {
    await this.inFlight;
  }

  async stop(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.flush();
  }

  private sendEligible(): void {
    if (this.inFlight !== undefined || this.latestText === this.failedText) return;
    const text = this.latestText;
    const segmentIndex = this.segmentIndex;
    this.inFlight = this.args.bot
      .sendRichMessageDraft({
        chatId: this.args.request.chatId,
        draftId: createSegmentDraftId(this.args.request.draftId, segmentIndex),
        richMessage: createRichMessage(this.args.request, text),
        options: this.args.request.draftOptions,
        signal: this.args.signal,
      })
      .then(
        () => {
          if (this.failedText === text) this.failedText = undefined;
        },
        () => {
          this.failedText = text;
        },
      )
      .finally(() => {
        this.inFlight = undefined;
        if (this.latestText !== text && this.latestText !== this.failedText) this.sendEligible();
      });
  }
}

async function sendFinalSegment<TError>(
  args: {
    readonly bot: TelegramBotClient;
    readonly request: TelegramRichStreamMessageRequest;
    readonly signal?: AbortSignal;
    readonly createError: (cause: unknown) => TError;
  },
  text: string,
  keepReplyParameters: boolean,
): Promise<Message.RichMessageMessage> {
  return args.bot.sendRichMessage({
    chatId: args.request.chatId,
    richMessage: createRichMessage(args.request, text),
    options: finalOptions(args.request.messageOptions, keepReplyParameters),
    signal: args.signal,
  });
}

function createRichMessage(
  request: TelegramRichStreamMessageRequest,
  text: string,
): InputRichMessage {
  const base = request.baseInputRichMessage ?? {};
  return request.format === "markdown" ? { ...base, markdown: text } : { ...base, html: text };
}

function finalOptions(
  options: TelegramRichStreamMessageRequest["messageOptions"],
  keepReplyParameters: boolean,
): TelegramRichStreamMessageRequest["messageOptions"] {
  if (keepReplyParameters || options?.reply_parameters === undefined) return options;
  const { reply_parameters: _replyParameters, ...rest } = options;
  return rest;
}

function createSegmentDraftId(baseDraftId: number, segmentIndex: number): number {
  return Math.max(1, baseDraftId + segmentIndex);
}

function countCodePoints(text: string): number {
  return Array.from(text).length;
}

function sliceCodePoints(text: string, start: number, end?: number): string {
  return Array.from(text).slice(start, end).join("");
}

function chooseSplitIndex(text: string, limit: number): number {
  const codePoints = Array.from(text);
  if (codePoints.length <= limit) return codePoints.length;
  const prefix = codePoints.slice(0, limit).join("");

  for (const token of ["\n\n", "\n", " ", "\t"] as const) {
    const codeUnitIndex = prefix.lastIndexOf(token);
    if (codeUnitIndex > 0) return Array.from(prefix.slice(0, codeUnitIndex + token.length)).length;
  }

  return limit;
}
