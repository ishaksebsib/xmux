import { createServer, type Server as HttpServer } from "node:http";
import { Effect, FileSystem } from "effect";
import { ControlServerError } from "../errors";
import type { ServerClock } from "../options";
import type { ServerRuntimePaths } from "../runtime-state/paths";
import { ShutdownCoordinator } from "../runtime/shutdown-coordinator";
import { StatusRegistry } from "../runtime/status-registry";
import { routeControlRequest } from "./router";
import { writeControlResponse } from "./response";

/** Bound control server handle is intentionally tiny; resources are scoped. */
export interface ControlServerHandle {
  readonly endpoint: ServerRuntimePaths["controlEndpoint"];
}

interface AcquiredUnixControlServer extends ControlServerHandle {
  readonly endpoint: {
    readonly kind: "unix-socket";
    readonly path: string;
  };
  readonly server: HttpServer;
}

/** Control server inputs come from the shell after paths and lock are owned. */
export interface BindControlServerInput {
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly clock: ServerClock;
}

const mapBindError = (path: string, cause: unknown): ControlServerError =>
  new ControlServerError({
    operation: "bind",
    path,
    message: `Failed to bind control socket: ${path}`,
    cause,
  });

const listenOnUnixSocket = (
  server: HttpServer,
  socketPath: string,
): Effect.Effect<void, ControlServerError> =>
  Effect.callback<void, ControlServerError>((resume) => {
    let resumed = false;
    const resumeOnce = (effect: Effect.Effect<void, ControlServerError>): void => {
      if (resumed) return;
      resumed = true;
      cleanup();
      resume(effect);
    };
    const onError = (cause: unknown): void => {
      resumeOnce(Effect.fail(mapBindError(socketPath, cause)));
    };
    const onListening = (): void => {
      resumeOnce(Effect.void);
    };
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(socketPath);
    } catch (cause) {
      resumeOnce(Effect.fail(mapBindError(socketPath, cause)));
    }

    return Effect.sync(() => {
      cleanup();
      if (!server.listening) return;
      server.close();
    });
  });

const closeServer = (
  server: HttpServer,
  socketPath: string,
): Effect.Effect<void, ControlServerError> =>
  Effect.callback<void, ControlServerError>((resume) => {
    if (!server.listening) {
      resume(Effect.void);
      return;
    }

    server.close((cause: Error | undefined) => {
      if (cause !== undefined) {
        resume(
          Effect.fail(
            new ControlServerError({
              operation: "close",
              path: socketPath,
              message: `Failed to close control socket: ${socketPath}`,
              cause,
            }),
          ),
        );
        return;
      }
      resume(Effect.void);
    });
  });

const removeSocketFile = (
  socketPath: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(socketPath, { force: true }).pipe(Effect.ignore);
  });

const acquireUnixControlServer = Effect.fn("server.acquireUnixControlServer")(function* (
  input: BindControlServerInput,
) {
  if (input.paths.controlEndpoint.kind !== "unix-socket") {
    return yield* new ControlServerError({
      operation: "bind",
      path: input.paths.runtimeDir,
      message: "Control server binding requires a Unix socket endpoint.",
    });
  }

  const socketPath = input.paths.controlEndpoint.path;
  const status = yield* StatusRegistry;
  const shutdown = yield* ShutdownCoordinator;
  yield* removeSocketFile(socketPath);

  const server = createServer((request, response) => {
    const program = routeControlRequest({
      method: request.method,
      url: request.url,
      paths: input.paths,
      startedAt: input.startedAt,
      clock: input.clock,
    }).pipe(
      Effect.flatMap((routeResult) =>
        writeControlResponse(response, routeResult.response).pipe(
          Effect.andThen(routeResult.afterResponse),
        ),
      ),
      Effect.provideService(StatusRegistry, status),
      Effect.provideService(ShutdownCoordinator, shutdown),
    );

    void Effect.runPromise(program).catch(() => undefined);
  });

  yield* listenOnUnixSocket(server, socketPath);
  yield* Effect.logInfo("control server listening", { socketPath });

  return {
    endpoint: input.paths.controlEndpoint,
    server,
  };
});

/** Bind the local control transport as a scoped resource owned by the shell. */
export const bindControlServer = Effect.fn("server.bindControlServer")(function* (
  input: BindControlServerInput,
) {
  if (input.paths.controlEndpoint.kind === "test") {
    return { endpoint: input.paths.controlEndpoint };
  }

  return yield* Effect.acquireRelease(
    acquireUnixControlServer(input),
    (handle: AcquiredUnixControlServer) =>
      closeServer(handle.server, handle.endpoint.path).pipe(
        Effect.andThen(removeSocketFile(handle.endpoint.path)),
        Effect.ignore,
      ),
  );
});
