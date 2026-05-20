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

/** Webhook delivery is reserved for the future webhook runtime path. */
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
