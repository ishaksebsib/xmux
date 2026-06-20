import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Invalid Slack adapter configuration. */
export class SlackConfigurationError extends TaggedError("SlackConfigurationError")<{
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
        `Invalid Slack adapter configuration for ${args.field}: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack Socket Mode runtime startup failed. */
export class SlackStartError extends TaggedError("SlackStartError")<{
  readonly operation: "socket_mode" | "start";
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly operation: "socket_mode" | "start";
    readonly reason?: string;
    readonly cause?: unknown;
  }) {
    super({
      operation: args.operation,
      cause: args.cause,
      message:
        args.reason ?? `Slack ${args.operation} startup failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack text formatting failed before a message could be sent. */
export class SlackFormattingError extends TaggedError("SlackFormattingError")<{
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
      message: args.reason ?? `Slack formatting failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack sendMessage failed. */
export class SlackSendMessageError extends TaggedError("SlackSendMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack sendMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack reply failed. */
export class SlackReplyError extends TaggedError("SlackReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack reply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack sendAction failed. */
export class SlackSendActionError extends TaggedError("SlackSendActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack sendAction failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack action response failed. */
export class SlackActionResponseError extends TaggedError("SlackActionResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack action response failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack streamMessage failed. */
export class SlackStreamMessageError extends TaggedError("SlackStreamMessageError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack streamMessage failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack streamReply failed. */
export class SlackStreamReplyError extends TaggedError("SlackStreamReplyError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: { readonly reason?: string; readonly cause?: unknown }) {
    super({
      cause: args.cause,
      message: args.reason ?? `Slack streamReply failed: ${describeCause(args.cause)}`,
    });
  }
}

/** Slack attachment download/open failed. */
export class SlackAttachmentReadError extends TaggedError("SlackAttachmentReadError")<{
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
      message: `Slack attachment ${args.attachmentId} read failed (${args.reason}; ${size}${limit}): ${describeCause(args.cause)}`,
    });
  }
}

/** Slack inbound Socket Mode event decoding failed. */
export class SlackInboundDecodeError extends TaggedError("SlackInboundDecodeError")<{
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
        `Slack inbound ${args.eventType} decode failed: ${describeCause(args.cause)}`,
    });
  }
}

/** HTTP Events API delivery is reserved for a future runtime path. */
export class SlackHttpModeUnsupportedError extends TaggedError("SlackHttpModeUnsupportedError")<{
  readonly message: string;
}>() {
  constructor() {
    super({
      message:
        "Slack HTTP Events API mode is not implemented yet. Use Socket Mode until HTTP handling is added.",
    });
  }
}

export type SlackAdapterError =
  | SlackActionResponseError
  | SlackAttachmentReadError
  | SlackConfigurationError
  | SlackFormattingError
  | SlackHttpModeUnsupportedError
  | SlackInboundDecodeError
  | SlackReplyError
  | SlackSendActionError
  | SlackSendMessageError
  | SlackStartError
  | SlackStreamMessageError
  | SlackStreamReplyError;
