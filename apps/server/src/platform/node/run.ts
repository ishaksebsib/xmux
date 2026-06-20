import { Effect } from "effect";
import type { ServerError } from "../../errors";
import { parseServerOptions, type RunXmuxServerOptions } from "../../options";
import { serverMain } from "../../server/main";
import { makeNodeServerLayer } from "./layer";

/** Node program boundary: parse public options and provide the production server layer. */
export const serverProgram = Effect.fn("server.program")(function* (options: RunXmuxServerOptions) {
  const parsedOptions = parseServerOptions(options);
  return yield* serverMain().pipe(Effect.provide(makeNodeServerLayer(parsedOptions)));
});

/** Public Effect boundary for the local Node server. */
export const runXmuxServer = (options: RunXmuxServerOptions): Effect.Effect<void, ServerError> =>
  Effect.scoped(serverProgram(options));
