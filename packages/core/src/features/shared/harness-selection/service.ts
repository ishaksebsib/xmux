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
