import { TaggedError } from "better-result";

/** Returned when the `/pwd` response cannot be sent back to chat. */
export class PwdCommandResponseError extends TaggedError("PwdCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ ...args, message: `Failed to send /pwd response: ${detail}` });
  }
}
