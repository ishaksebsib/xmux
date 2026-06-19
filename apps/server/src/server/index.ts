import { Effect } from "effect";
import type { ServerError } from "../errors";
import {
  makeNodeXmuxServerApp,
  makeNodeXmuxServerLayer,
  nodeServerServices,
} from "../platform/node";
import { parseServerOptions, type RunXmuxServerOptions } from "../options";

export { serverMain } from "./main";
export { ServerBinding, type ServerBindingContext } from "./binding";
export * as XmuxServerApp from "./app";
export { makeNodeXmuxServerApp, makeNodeXmuxServerLayer, nodeServerServices };

/** Compatibility alias for callers/tests that still use the old name. */
export const makeServerLayer = makeNodeXmuxServerLayer;

/** Program boundary normalizes public options and supplies the production Node app. */
export const serverProgram = Effect.fn("server.program")(function* (options: RunXmuxServerOptions) {
  const parsedOptions = parseServerOptions(options);
  const app = makeNodeXmuxServerApp(parsedOptions);
  return yield* app.main;
});

/** Public Effect boundary for use by clients. */
export const runXmuxServer = (options: RunXmuxServerOptions): Effect.Effect<void, ServerError> =>
  Effect.scoped(serverProgram(options));
