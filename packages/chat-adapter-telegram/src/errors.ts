import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Invalid Telegram adapter configuration. */
export class TelegramConfigurationError extends TaggedError("TelegramConfigurationError")<{
  readonly field: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly field: string;
    readonly reason?: string;
    readonly cause?: unknown;
  }) {
    super({
      field: args.field,
      cause: args.cause,
      message:
        args.reason ??
        `Invalid Telegram adapter configuration for ${args.field}: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram command registration failed. */
export class TelegramCommandRegistrationError extends TaggedError(
  "TelegramCommandRegistrationError",
)<{
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Telegram command registration failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram runtime startup failed. */
export class TelegramStartError extends TaggedError("TelegramStartError")<{
  readonly operation: "init" | "polling";
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly operation: "init" | "polling"; readonly cause: unknown }) {
    super({
      ...args,
      message: `Telegram ${args.operation} startup failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram reply failed. */
export class TelegramReplyError extends TaggedError("TelegramReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram reply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram streamReply failed. */
export class TelegramStreamReplyError extends TaggedError("TelegramStreamReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram streamReply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram streamMessage failed. */
export class TelegramStreamMessageError extends TaggedError("TelegramStreamMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram streamMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram sendAction failed. */
export class TelegramSendActionError extends TaggedError("TelegramSendActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram sendAction failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram updateAction failed. */
export class TelegramUpdateActionError extends TaggedError("TelegramUpdateActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram updateAction failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram action response failed. */
export class TelegramActionResponseError extends TaggedError("TelegramActionResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Telegram action response failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram sendMessage failed. */
export class TelegramSendMessageError extends TaggedError("TelegramSendMessageError")<{
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Telegram sendMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram attachment download/open failed. */
export class TelegramAttachmentReadError extends TaggedError("TelegramAttachmentReadError")<{
  readonly attachmentId: string;
  readonly reason: "metadata" | "missing_file_path" | "too_large" | "download" | "invalid_response";
  readonly maxBytes?: number;
  readonly sizeBytes?: number;
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly attachmentId: string;
    readonly reason:
      | "metadata"
      | "missing_file_path"
      | "too_large"
      | "download"
      | "invalid_response";
    readonly maxBytes?: number;
    readonly sizeBytes?: number;
    readonly cause?: unknown;
  }) {
    const size = args.sizeBytes === undefined ? "unknown size" : `${args.sizeBytes} bytes`;
    const limit = args.maxBytes === undefined ? "" : `; limit ${args.maxBytes} bytes`;

    super({
      ...args,
      message: `Telegram attachment ${args.attachmentId} read failed (${args.reason}; ${size}${limit}): ${describeCause(args.cause)}`,
    });
  }
}

/** Telegram sendChatAction typing indicator failed. */
export class TelegramSendTypingError extends TaggedError("TelegramSendTypingError")<{
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Telegram typing indicator failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Webhook delivery is reserved for the future webhook runtime path. */
export type TelegramAdapterError =
  | TelegramActionResponseError
  | TelegramAttachmentReadError
  | TelegramCommandRegistrationError
  | TelegramConfigurationError
  | TelegramReplyError
  | TelegramSendActionError
  | TelegramSendMessageError
  | TelegramUpdateActionError
  | TelegramSendTypingError
  | TelegramStartError
  | TelegramStreamMessageError
  | TelegramStreamReplyError
  | TelegramWebhookModeUnsupportedError;

export class TelegramWebhookModeUnsupportedError extends TaggedError(
  "TelegramWebhookModeUnsupportedError",
)<{
  readonly message: string;
}>() {
  constructor() {
    super({
      message:
        "Telegram webhook mode is not implemented yet. Use polling mode until webhook handling is added.",
    });
  }
}
