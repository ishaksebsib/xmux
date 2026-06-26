import { Flag } from "effect/unstable/cli";

/** Shared config-path flag used by xmux control commands. */
export const configPathFlag = Flag.string("config").pipe(
  Flag.optional,
  Flag.withDescription("Path to xmux config file."),
);

/** Stable JSON output flag for script-facing commands. */
export const jsonOutputFlag = Flag.boolean("json").pipe(Flag.withDescription("Print JSON output."));

/** Enables verbose failure rendering at the runtime boundary. */
export const debugFlag = Flag.boolean("debug").pipe(
  Flag.withDescription("Print detailed error diagnostics."),
);
