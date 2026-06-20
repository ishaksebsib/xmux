import { Context, Effect, Layer } from "effect";
import { ServerOptions } from "../options";
import type { ServerRuntimePaths } from "./paths";
import { resolveRuntimePaths } from "./paths";

/** RuntimePaths exposes the once-resolved filesystem/control layout as a service. */
export class RuntimePaths extends Context.Service<RuntimePaths, ServerRuntimePaths>()(
  "@xmux/server/RuntimePaths",
) {}

/** Resolve paths from normalized server options at the application boundary. */
export const RuntimePathsLayer = Layer.effect(RuntimePaths)(
  Effect.gen(function* () {
    const options = yield* ServerOptions;
    return yield* resolveRuntimePaths(options);
  }),
);
