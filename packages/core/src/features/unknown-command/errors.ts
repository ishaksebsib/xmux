import { TaggedError } from "better-result";

/** Returned when xmux cannot send the unknown-command response back to chat. */
export class UnknownCommandResponseError extends TaggedError("UnknownCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ ...args, message: `Failed to send unknown-command response: ${detail}` });
  }
}
