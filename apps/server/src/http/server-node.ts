import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { app } from "../api/app";
import { ServerBinding } from "./binding";
import { unixSocketServer } from "./unix-socket-node";

const nodeHttpServer = HttpRouter.serve(app, { disableListenLog: true }).pipe(
  Layer.provideMerge(unixSocketServer),
);

/** Node implementation of the scoped server transport binding. */
export const nodeBinding = Layer.succeed(ServerBinding)({
  bind: Layer.build(nodeHttpServer).pipe(Effect.asVoid),
});
