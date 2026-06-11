import { Result } from "better-result";
import type { ChatTextStreamChunk } from "@xmux/chat-core";
import type { Message, MessageEntity } from "grammy/types";
import type { TelegramBotClient } from "../client";
import {
  renderTelegramMarkdownFinal,
  renderTelegramMarkdownPreview,
  validateTelegramEntities,
  type TelegramRenderedText,
} from "../conversions/markdown-entities";
import {
  splitTelegramRenderedText,
  type TelegramRenderedSegment,
} from "../conversions/telegram-segments";
import type { TelegramStreamMessageRequest } from "../conversions/streaming";
import type { TelegramAdapterOptions } from "../types";

export interface TelegramMarkdownStreamResult {
  readonly text: string;
  readonly format: "markdown";
  readonly telegramMessages: Message.TextMessage[];
}

type DraftOptions = NonNullable<Parameters<TelegramBotClient["sendMessageDraft"]>[0]["options"]>;
type EditOptions = NonNullable<Parameters<TelegramBotClient["editMessageText"]>[0]["options"]>;

type CreateError<TError> = (cause: unknown) => TError;

const TELEGRAM_DRAFT_HEARTBEAT_INTERVAL_MS = 4_000;

export function streamTelegramMarkdown<TError>(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number;
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly request: TelegramStreamMessageRequest;
  readonly signal?: AbortSignal;
  readonly createError: CreateError<TError>;
}): Promise<Result<TelegramMarkdownStreamResult, TError>> {
  return Result.tryPromise({
    try: () => runTelegramMarkdownStream(args),
    catch: args.createError,
  });
}

async function runTelegramMarkdownStream(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number;
  readonly chunks: AsyncIterable<ChatTextStreamChunk>;
  readonly request: TelegramStreamMessageRequest;
  readonly signal?: AbortSignal;
}): Promise<TelegramMarkdownStreamResult> {
  let rawMarkdown = "";
  const sentMessages: Message.TextMessage[] = [];
  const drafts = new DraftScheduler({
    bot: args.bot,
    chatId: args.chatId,
    draftIdOffset: args.request.draftIdOffset,
    draftOptions: args.request.draftOptions,
    signal: args.signal,
    heartbeatIntervalMs: TELEGRAM_DRAFT_HEARTBEAT_INTERVAL_MS,
  });

  try {
    for await (const chunk of args.chunks) {
      throwIfAborted(args.signal);
      rawMarkdown = appendChunk(rawMarkdown, chunk);
      const preview = renderTelegramMarkdownPreview(rawMarkdown);
      await publishPreview({
        bot: args.bot,
        chatId: args.chatId,
        rendered: preview,
        messageOptions: args.request.messageOptions,
        sentMessages,
        drafts,
        signal: args.signal,
      });
    }

    await drafts.stop();

    const finalRendered = renderTelegramMarkdownFinal(rawMarkdown);
    await reconcileFinalSegments({
      bot: args.bot,
      chatId: args.chatId,
      rendered: finalRendered,
      messageOptions: args.request.messageOptions,
      sentMessages,
      signal: args.signal,
    });

    if (sentMessages.length === 0) {
      throw new Error("Telegram markdown stream did not send any messages");
    }

    return { text: rawMarkdown, format: "markdown", telegramMessages: sentMessages };
  } finally {
    await drafts.stop();
  }
}

function appendChunk(current: string, chunk: ChatTextStreamChunk): string {
  if (chunk.type === "delta") {
    return current + chunk.delta;
  }

  if (chunk.text === undefined) {
    return current;
  }

  if (!chunk.text.startsWith(current)) {
    throw new Error("Telegram native streaming only supports append-only text snapshots");
  }

  return chunk.text;
}

async function publishPreview(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number;
  readonly rendered: TelegramRenderedText;
  readonly messageOptions?: TelegramAdapterOptions;
  readonly sentMessages: Message.TextMessage[];
  readonly drafts: DraftScheduler;
  readonly signal?: AbortSignal;
}): Promise<void> {
  assertValidRenderedText(args.rendered);
  const segments = splitTelegramRenderedText(args.rendered);
  if (segments.length === 0) {
    return;
  }

  while (args.sentMessages.length < segments.length - 1) {
    const segment = segments[args.sentMessages.length];
    if (segment === undefined) {
      break;
    }

    await args.drafts.flush();
    args.drafts.clearIfCurrent(segment.index);
    const message = await sendSegment({
      bot: args.bot,
      chatId: args.chatId,
      segment,
      messageOptions: args.messageOptions,
      isFirstMessage: args.sentMessages.length === 0,
      signal: args.signal,
    });
    args.sentMessages.push(message);
  }

  const current = segments[args.sentMessages.length];
  if (current !== undefined) {
    args.drafts.schedule(current);
  }
}

async function reconcileFinalSegments(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number;
  readonly rendered: TelegramRenderedText;
  readonly messageOptions?: TelegramAdapterOptions;
  readonly sentMessages: Message.TextMessage[];
  readonly signal?: AbortSignal;
}): Promise<void> {
  assertValidRenderedText(args.rendered);
  const finalSegments = splitTelegramRenderedText(args.rendered);

  for (let index = 0; index < finalSegments.length; index += 1) {
    throwIfAborted(args.signal);
    const segment = finalSegments[index];
    if (segment === undefined) {
      continue;
    }

    const existing = args.sentMessages[index];
    if (existing === undefined) {
      const message = await sendSegment({
        bot: args.bot,
        chatId: args.chatId,
        segment,
        messageOptions: args.messageOptions,
        isFirstMessage: args.sentMessages.length === 0,
        signal: args.signal,
      });
      args.sentMessages.push(message);
      continue;
    }

    if (!messageMatchesSegment(existing, segment)) {
      try {
        await args.bot.editMessageText({
          chatId: existing.chat.id,
          messageId: existing.message_id,
          text: segment.text,
          options: withEditEntities(segment.entities),
          signal: args.signal,
        });
      } catch (cause) {
        if (!isTelegramMessageNotModifiedError(cause)) {
          throw cause;
        }
      }

      args.sentMessages[index] = {
        ...existing,
        text: segment.text,
        entities: [...segment.entities],
      };
    }
  }

  while (args.sentMessages.length > finalSegments.length) {
    throwIfAborted(args.signal);
    const extra = args.sentMessages.pop();
    if (extra !== undefined) {
      await args.bot.deleteMessage({
        chatId: extra.chat.id,
        messageId: extra.message_id,
        signal: args.signal,
      });
    }
  }
}

async function sendSegment(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number;
  readonly segment: TelegramRenderedSegment;
  readonly messageOptions?: TelegramAdapterOptions;
  readonly isFirstMessage: boolean;
  readonly signal?: AbortSignal;
}): Promise<Message.TextMessage> {
  throwIfAborted(args.signal);
  const options = withSegmentEntities(
    args.messageOptions,
    args.segment.entities,
    args.isFirstMessage,
  );
  const message = await args.bot.sendMessage({
    chatId: args.chatId,
    text: args.segment.text,
    options,
    signal: args.signal,
  });

  return message as Message.TextMessage;
}

function messageMatchesSegment(
  message: Message.TextMessage,
  segment: TelegramRenderedSegment,
): boolean {
  return message.text === segment.text && sameEntities(message.entities ?? [], segment.entities);
}

function sameEntities(left: readonly MessageEntity[], right: readonly MessageEntity[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entity, index) => {
    const other = right[index];
    return other !== undefined && sameEntity(entity, other);
  });
}

function sameEntity(left: MessageEntity, right: MessageEntity): boolean {
  if (left.type !== right.type || left.offset !== right.offset || left.length !== right.length) {
    return false;
  }

  if (left.type === "pre" && right.type === "pre") {
    return left.language === right.language;
  }

  if (left.type === "text_link" && right.type === "text_link") {
    return left.url === right.url;
  }

  if (left.type === "text_mention" && right.type === "text_mention") {
    return left.user.id === right.user.id;
  }

  if (left.type === "custom_emoji" && right.type === "custom_emoji") {
    return left.custom_emoji_id === right.custom_emoji_id;
  }

  if (left.type === "date_time" && right.type === "date_time") {
    return left.unix_time === right.unix_time && left.date_time_format === right.date_time_format;
  }

  return true;
}

function withSegmentEntities(
  options: TelegramAdapterOptions | undefined,
  entities: readonly MessageEntity[],
  isFirstMessage: boolean,
): TelegramAdapterOptions {
  const base = optionsWithoutReplyParameters(options, isFirstMessage);
  return entities.length === 0 ? base : { ...base, entities: [...entities] };
}

function withEditEntities(entities: readonly MessageEntity[]): EditOptions {
  return entities.length === 0 ? {} : { entities: [...entities] };
}

function isTelegramMessageNotModifiedError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }

  const error = cause as { readonly description?: unknown; readonly error_code?: unknown };
  return (
    error.error_code === 400 &&
    typeof error.description === "string" &&
    error.description.includes("message is not modified")
  );
}

function optionsWithoutReplyParameters(
  options: TelegramAdapterOptions | undefined,
  keepReplyParameters: boolean,
): TelegramAdapterOptions {
  if (options === undefined || keepReplyParameters) {
    return options ?? {};
  }

  const { reply_parameters: _replyParameters, ...rest } = options;
  return rest;
}

class DraftScheduler {
  private latest: TelegramRenderedSegment | undefined;
  private queued: TelegramRenderedSegment | undefined;
  private inFlight: Promise<void> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private disabled = false;
  private stopped = false;

  constructor(
    private readonly args: {
      readonly bot: TelegramBotClient;
      readonly chatId: number;
      readonly draftIdOffset: number;
      readonly draftOptions?: TelegramStreamMessageRequest["draftOptions"];
      readonly signal?: AbortSignal;
      readonly heartbeatIntervalMs: number;
    },
  ) {}

  schedule(segment: TelegramRenderedSegment): void {
    if (this.disabled || this.stopped) {
      return;
    }

    this.latest = segment;
    this.queued = segment;
    this.ensureHeartbeat();
    this.startIfIdle();
  }

  clearIfCurrent(index: number): void {
    if (this.latest?.index === index) {
      this.latest = undefined;
    }

    if (this.queued?.index === index) {
      this.queued = undefined;
    }

    if (this.latest === undefined) {
      this.clearHeartbeat();
    }
  }

  async flush(): Promise<void> {
    while (this.inFlight !== undefined || this.queued !== undefined) {
      if (this.inFlight === undefined) {
        this.startIfIdle();
      }
      await this.inFlight;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.clearHeartbeat();
    await this.flush();
    this.latest = undefined;
    this.stopped = true;
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== undefined) {
      return;
    }

    this.heartbeat = setInterval(() => {
      this.refreshLatest();
    }, this.args.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat === undefined) {
      return;
    }

    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private refreshLatest(): void {
    if (
      this.disabled ||
      this.stopped ||
      this.latest === undefined ||
      this.queued !== undefined ||
      this.inFlight !== undefined
    ) {
      return;
    }

    this.queued = this.latest;
    this.startIfIdle();
  }

  private startIfIdle(): void {
    if (this.disabled || this.stopped || this.inFlight !== undefined || this.queued === undefined) {
      return;
    }

    const segment = this.queued;
    this.queued = undefined;
    this.inFlight = this.sendDraft(segment)
      .catch(() => {
        this.disabled = true;
        this.queued = undefined;
        this.latest = undefined;
        this.clearHeartbeat();
      })
      .finally(() => {
        this.inFlight = undefined;
        if (this.queued !== undefined && !this.disabled && !this.stopped) {
          this.startIfIdle();
        }
      });
  }

  private async sendDraft(segment: TelegramRenderedSegment): Promise<void> {
    throwIfAborted(this.args.signal);
    await this.args.bot.sendMessageDraft({
      chatId: this.args.chatId,
      draftId: this.args.draftIdOffset + segment.index,
      text: segment.text,
      options: withDraftEntities(this.args.draftOptions, segment.entities),
      signal: this.args.signal,
    });
  }
}

function withDraftEntities(
  options: TelegramStreamMessageRequest["draftOptions"] | undefined,
  entities: readonly MessageEntity[],
): DraftOptions {
  const { parse_mode: _parseMode, ...rest } = options ?? {};
  return entities.length === 0 ? rest : { ...rest, entities: [...entities] };
}

function assertValidRenderedText(rendered: TelegramRenderedText): void {
  const validation = validateTelegramEntities(rendered);
  if (validation.isErr()) {
    throw validation.error;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Telegram markdown stream aborted");
  }
}
