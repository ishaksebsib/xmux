import { TaggedError } from "better-result";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Returned when an interaction command response cannot be sent back to chat. */
export class InteractionCommandResponseError extends TaggedError(
  "InteractionCommandResponseError",
)<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send interaction command response: ${describeCause(args.cause)}`,
    });
  }
}
