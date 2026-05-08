import { TaggedError } from "better-result";
import type { XmuxCloseCause } from "./contracts";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class XmuxInitializeError extends TaggedError("XmuxInitializeError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { cause: unknown }) {
    super({
      ...args,
      message: `Failed to initialize xmux: ${describeCause(args.cause)}`,
    });
  }
}

export class XmuxCloseError extends TaggedError("XmuxCloseError")<{
  readonly cause: XmuxCloseCause;
  readonly message: string;
}>() {
  constructor(cause: XmuxCloseCause) {
    const parts = [] as string[];

    if (cause.harness) {
      parts.push(cause.harness.message);
    }

    if (cause.chat !== undefined) {
      parts.push(`Failed to shut down chat runtime: ${describeCause(cause.chat)}`);
    }

    super({
      cause,
      message: parts.join("; ") || "Failed to close xmux runtime",
    });
  }
}
