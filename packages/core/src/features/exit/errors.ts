import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Returned when the `/exit` response cannot be sent back to chat. */
export class ExitCommandResponseError extends TaggedError("ExitCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send /exit response: ${describeCause(args.cause)}` });
  }
}
