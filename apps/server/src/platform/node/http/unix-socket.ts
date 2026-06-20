import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { ControlServerError } from "../../../errors";
import { RuntimePaths } from "../../../runtime-state/runtime-paths-service";

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

/** Node Unix-socket adapter; all route logic stays in the API layer. */
export const unixSocketServer = Layer.unwrap(
  Effect.gen(function* () {
    const paths = yield* RuntimePaths;

    const socketPath = paths.controlEndpoint.path;

    return Layer.mergeAll(
      NodeHttpServer.layerHttpServices,
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
      ),
    );
  }),
);
