import { Result } from "better-result";
import { CommandHarnessNotConfiguredError } from "../../errors";
import { requireConfiguredHarnessId } from "../../utils";

/**
 * Output produced by commands that ask the user to pick one of the configured
 * harnesses before continuing (for example a bare `/new`, `/resume`, or
 * `/delete`). Carries the workspace directory shown in the prompt and the set
 * of harness ids rendered as selection buttons.
 */
export interface HarnessSelectionOutput {
  readonly status: "harnesses";
  readonly cwd: string;
  readonly harnessIds: readonly string[];
}

export interface HarnessSelectedOutput<THarnessId extends string = string> {
  readonly status: "selected";
  readonly harnessId: THarnessId;
}

export type HarnessChoiceOutput<THarnessId extends string = string> =
  | HarnessSelectionOutput
  | HarnessSelectedOutput<THarnessId>;

export function resolveHarnessChoice<THarnessId extends string>(input: {
  readonly harnessId?: string;
  readonly availableHarnessIds: readonly THarnessId[];
  readonly cwd: string;
}): Result<HarnessChoiceOutput<THarnessId>, CommandHarnessNotConfiguredError> {
  const harnessId = input.harnessId?.trim();

  if (harnessId) {
    return Result.map(
      requireConfiguredHarnessId({
        harnessId,
        availableHarnessIds: input.availableHarnessIds,
        onMissing: (args) => new CommandHarnessNotConfiguredError(args),
      }),
      (configuredHarnessId) => ({
        status: "selected" as const,
        harnessId: configuredHarnessId,
      }),
    );
  }

  if (input.availableHarnessIds.length === 1) {
    const harnessId = input.availableHarnessIds[0];
    if (harnessId !== undefined) {
      return Result.ok({ status: "selected" as const, harnessId });
    }
  }

  return Result.ok({
    status: "harnesses" as const,
    cwd: input.cwd,
    harnessIds: input.availableHarnessIds,
  });
}
