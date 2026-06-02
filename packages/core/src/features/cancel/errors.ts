import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Returned when the `/cancel` response cannot be sent back to chat. */
export class CancelCommandResponseError extends TaggedError("CancelCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send /cancel response: ${describeCause(args.cause)}` });
  }
}
