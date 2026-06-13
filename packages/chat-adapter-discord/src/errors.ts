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

/** Discord gateway runtime work is intentionally deferred beyond the scaffold phase. */
export class DiscordNotImplementedError extends TaggedError("DiscordNotImplementedError")<{
  readonly operation: string;
  readonly message: string;
}>() {
  constructor(args: { readonly operation: string }) {
    super({
      ...args,
      message: `Discord ${args.operation} is not implemented yet. Gateway runtime support is planned for the next phase.`,
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
  | DiscordConfigurationError
  | DiscordNotImplementedError
  | DiscordWebhookModeUnsupportedError;
