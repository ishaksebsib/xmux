import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { ServerConfig } from "../../../config/service";
import { ControlServerError } from "../../../errors";
import { LogReader } from "../../../logging/log-reader";
import { ServerIdentity } from "../../../server-runtime/identity";
import { ShutdownCoordinator } from "../../../server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../../../server-runtime/state";
import { RuntimePaths } from "../../../server-control/paths";
import { ControlTransport } from "../../../server-control/ports";
import { app } from "../../../api/app";

export const removeSocket = (
  socketPath: string,
  operation: "bind" | "close",
): Effect.Effect<void, ControlServerError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(socketPath, { force: true }).pipe(
      Effect.mapError((cause) =>
        ControlServerError.make({
          operation,
          path: socketPath,
          message: `Failed to remove server socket: ${socketPath}`,
          cause,
        }),
      ),
    );
  });

const makeUnixSocketHttpServerLayer = (socketPath: string) =>
  Layer.effect(HttpServer.HttpServer)(
    Effect.gen(function* () {
      yield* removeSocket(socketPath, "bind");
      yield* Effect.addFinalizer(() =>
        removeSocket(socketPath, "close").pipe(
          Effect.tapError((error) =>
            Effect.logWarning("failed to remove server socket", { error }),
          ),
          Effect.ignore,
        ),
      );

      const server = yield* NodeHttpServer.make(createServer, { path: socketPath }).pipe(
        Effect.mapError((cause) =>
          ControlServerError.make({
            operation: "bind",
            path: socketPath,
            message: `Failed to bind server socket: ${socketPath}`,
            cause,
          }),
        ),
      );
      yield* Effect.logInfo("server HTTP listening", { socketPath });
      return server;
    }),
  ).pipe(Layer.provideMerge(NodeHttpServer.layerHttpServices));

/** Node Unix-socket transport for the local control API. */
export const NodeUnixSocketControlTransport = Layer.effect(ControlTransport)(
  Effect.gen(function* () {
    const paths = yield* RuntimePaths;
    const config = yield* ServerConfig;
    const logReader = yield* LogReader;
    const identity = yield* ServerIdentity;
    const shutdown = yield* ShutdownCoordinator;
    const status = yield* StatusRegistry;

    const socketPath = paths.controlEndpoint.path;
    const apiDependencies = Layer.mergeAll(
      Layer.succeed(RuntimePaths)(paths),
      Layer.succeed(ServerConfig)(config),
      Layer.succeed(LogReader)(logReader),
      Layer.succeed(ServerIdentity)(identity),
      Layer.succeed(ShutdownCoordinator)(shutdown),
      Layer.succeed(StatusRegistry)(status),
    );
    const httpServer = makeUnixSocketHttpServerLayer(socketPath);
    const servingLayer = HttpRouter.serve(app, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provideMerge(httpServer), Layer.provide(apiDependencies));

    return {
      bind: Layer.build(servingLayer).pipe(Effect.asVoid),
    };
  }),
);
