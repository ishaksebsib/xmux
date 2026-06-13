import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Invalid Discord adapter configuration. */
export class DiscordConfigurationError extends TaggedError("DiscordConfigurationError")<{
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
        `Invalid Discord adapter configuration for ${args.field}: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord gateway runtime startup failed. */
export class DiscordStartError extends TaggedError("DiscordStartError")<{
  readonly operation: "login";
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly operation: "login"; readonly cause: unknown }) {
    super({
      ...args,
      message: `Discord ${args.operation} startup failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord slash-command registration failed. */
export class DiscordCommandRegistrationError extends TaggedError(
  "DiscordCommandRegistrationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord command registration failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord text formatting failed before a message could be sent. */
export class DiscordFormattingError extends TaggedError("DiscordFormattingError")<{
  readonly format?: "plain" | "markdown" | "html";
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly format?: "plain" | "markdown" | "html";
    readonly reason?: string;
    readonly cause?: unknown;
  }) {
    super({
      format: args.format,
      cause: args.cause,
      message: args.reason ?? `Discord formatting failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord sendMessage failed. */
export class DiscordSendMessageError extends TaggedError("DiscordSendMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord sendMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord reply failed. */
export class DiscordReplyError extends TaggedError("DiscordReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord reply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord sendAction failed. */
export class DiscordSendActionError extends TaggedError("DiscordSendActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord sendAction failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord action response failed. */
export class DiscordActionResponseError extends TaggedError("DiscordActionResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord action response failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord typing indicator failed. */
export class DiscordSendTypingError extends TaggedError("DiscordSendTypingError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord typing indicator failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord streamMessage failed. */
export class DiscordStreamMessageError extends TaggedError("DiscordStreamMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord streamMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord streamReply failed. */
export class DiscordStreamReplyError extends TaggedError("DiscordStreamReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Discord streamReply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Discord attachment download/open failed. */
export class DiscordAttachmentReadError extends TaggedError("DiscordAttachmentReadError")<{
  readonly attachmentId: string;
  readonly reason: "too_large" | "download" | "invalid_response" | "missing_body";
  readonly maxBytes?: number;
  readonly sizeBytes?: number;
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly attachmentId: string;
    readonly reason: "too_large" | "download" | "invalid_response" | "missing_body";
    readonly maxBytes?: number;
    readonly sizeBytes?: number;
    readonly cause?: unknown;
  }) {
    const size = args.sizeBytes === undefined ? "unknown size" : `${args.sizeBytes} bytes`;
    const limit = args.maxBytes === undefined ? "" : `; limit ${args.maxBytes} bytes`;

    super({
      ...args,
      message: `Discord attachment ${args.attachmentId} read failed (${args.reason}; ${size}${limit}): ${describeCause(args.cause)}`,
    });
  }
}

/** Discord inbound gateway event decoding failed. */
export class DiscordInboundDecodeError extends TaggedError("DiscordInboundDecodeError")<{
  readonly eventType: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly eventType: string;
    readonly reason?: string;
    readonly cause?: unknown;
  }) {
    super({
      eventType: args.eventType,
      cause: args.cause,
      message:
        args.reason ??
        `Discord inbound ${args.eventType} decode failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Webhook delivery is reserved for the future HTTP interaction runtime path. */
export class DiscordWebhookModeUnsupportedError extends TaggedError(
  "DiscordWebhookModeUnsupportedError",
)<{
  readonly message: string;
}>() {
  constructor() {
    super({
      message:
        "Discord webhook mode is not implemented yet. Use gateway mode until webhook handling is added.",
    });
  }
}

export type DiscordAdapterError =
  | DiscordActionResponseError
  | DiscordAttachmentReadError
  | DiscordCommandRegistrationError
  | DiscordConfigurationError
  | DiscordFormattingError
  | DiscordInboundDecodeError
  | DiscordReplyError
  | DiscordSendActionError
  | DiscordSendMessageError
  | DiscordSendTypingError
  | DiscordStartError
  | DiscordStreamMessageError
  | DiscordStreamReplyError
  | DiscordWebhookModeUnsupportedError;
