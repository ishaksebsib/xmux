import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect } from "effect";
import { cliProgram } from "../../index";
import { renderCliFailureNode } from "./errors";
import { cliNodeRuntimeLayer } from "./layer";

export const runCliNode = (): void => {
  // NodeRuntime is the CLI process signal bridge: SIGINT/SIGTERM interrupt the
  // main Effect fiber, allowing server scopes/finalizers to close cleanly.
  cliProgram.pipe(
    Effect.provide(cliNodeRuntimeLayer),
    Effect.scoped,
    Effect.catchCause((cause) => Effect.sync(() => renderCliFailureNode(cause))),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  );
};
