import { TaggedError } from "better-result";

/** Returned when the `/ls` response cannot be sent back to chat. */
export class LsCommandResponseError extends TaggedError("LsCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ ...args, message: `Failed to send /ls response: ${detail}` });
  }
}
