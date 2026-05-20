import { TaggedError } from "better-result";

/** Returned when `/new` targets a harness that is not configured in xmux. */
export class NewCommandHarnessNotConfiguredError extends TaggedError(
  "NewCommandHarnessNotConfiguredError",
)<{
  readonly harnessId: string;
  readonly availableHarnessIds: readonly string[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly harnessId: string;
    readonly availableHarnessIds: readonly string[];
  }) {
    super({
      ...args,
      message: `Unknown harness '${args.harnessId}'. Available harnesses: ${
        args.availableHarnessIds.join(", ") || "none"
      }`,
    });
  }
}

/** Returned when xmux cannot send the `/new` response back to chat. */
export class NewCommandResponseError extends TaggedError("NewCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({ ...args, message: `Failed to send /new response: ${detail}` });
  }
}
