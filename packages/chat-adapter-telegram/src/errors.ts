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
  constructor(args: { readonly field: string; readonly reason?: string; readonly cause?: unknown }) {
    super({
      field: args.field,
      cause: args.cause,
      message:
        args.reason ??
        `Invalid Telegram adapter configuration for ${args.field}: ${describeCause(args.cause)}`,
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
