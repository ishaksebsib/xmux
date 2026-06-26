import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { rootCommand } from "./commands/root";
import { cliRuntimeLayer } from "./layer";
import { renderCliFailure } from "./output/errors";

export { rootCommand } from "./commands/root";

export const cliVersion = packageJson.version;

export const cliProgram = Command.run(rootCommand, {
  version: cliVersion,
});

export const runCli = (): void => {
  // NodeRuntime is the CLI process signal bridge: SIGINT/SIGTERM interrupt the
  // main Effect fiber, allowing server scopes/finalizers to close cleanly.
  cliProgram.pipe(
    Effect.provide(cliRuntimeLayer),
    Effect.scoped,
    Effect.catchCause((cause) => Effect.sync(() => renderCliFailure(cause))),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  );
};
