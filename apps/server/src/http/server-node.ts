import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { XmuxServerAppLive } from "../api/app";
import { RuntimePaths } from "../runtime-state/runtime-paths-service";
import { UnixSocketHttpServerLive } from "./unix-socket-node";

/** Scoped local HTTP server layer. Test endpoints intentionally do not bind a socket. */
export const XmuxHttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const paths = yield* RuntimePaths;
    if (paths.controlEndpoint.kind === "test") {
      return Layer.empty;
    }

    return HttpRouter.serve(XmuxServerAppLive, { disableListenLog: true }).pipe(
      Layer.provideMerge(UnixSocketHttpServerLive),
    );
  }),
);
