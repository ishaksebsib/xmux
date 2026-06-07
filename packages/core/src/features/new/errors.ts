import { TaggedError } from "better-result";

/** Returned when `/new` targets a harness that is not configured. */
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
