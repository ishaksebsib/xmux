import { Effect, Layer } from "effect";
import { ServerConfig } from "./config/service";
import type { ServerError } from "./errors";
import { withFileLogger } from "./logging/file-logger";
import { LogReader } from "./logging/log-reader";
import { assertNoActiveServer } from "./server-control/active-server";
import { acquireManifestOwnership } from "./server-control/manifest";
import { ensureRuntimeDirectories } from "./server-control/paths";
import { RuntimePaths } from "./server-control/paths";
import { withStartupLock } from "./server-control/startup-lock";
import { ControlTransport } from "./server-control/ports";
import { ServerIdentity } from "./server-runtime/identity";
import { ShutdownCoordinator } from "./server-runtime/shutdown-coordinator";
import { StatusRegistry } from "./server-runtime/state";

export { ControlTransport } from "./server-control/ports";

/** Platform-neutral server services; host layers provide platform, secrets, probe, and transport. */
export const serverRuntimeLayer = Layer.mergeAll(
  RuntimePaths.layer,
  ServerConfig.layer,
  LogReader.layer,
  ServerIdentity.layer,
  ShutdownCoordinator.layer,
  StatusRegistry.layer,
);

/** Main server workflow owns startup ordering while services come from context. */
export const serverMain = Effect.fn("server.main")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const config = yield* ServerConfig;
  const status = yield* StatusRegistry;
  const shutdown = yield* ShutdownCoordinator;
  const transport = yield* ControlTransport;

  yield* ensureRuntimeDirectories(paths);
  const effectiveConfig = yield* config.loadCurrent(paths.configPath);

  return yield* withFileLogger(
    { logDir: paths.logDir, logLevel: effectiveConfig.server.logLevel },
    Effect.gen(function* () {
      yield* assertNoActiveServer(paths);

      yield* withStartupLock(
        { startupLockPath: paths.startupLockPath },
        Effect.gen(function* () {
          yield* assertNoActiveServer(paths);
          yield* transport.bind();
          yield* acquireManifestOwnership({
            paths,
            startedAt: identity.startedAt,
            sessionId: identity.sessionId,
          });
        }),
      );

      yield* status.setState("ready");
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* status.setState("stopping");
          yield* Effect.logInfo("server stopped", {
            startedAt: identity.startedAt.toISOString(),
          });
        }).pipe(Effect.ignore),
      );
      yield* Effect.logInfo("server started", {
        startedAt: identity.startedAt.toISOString(),
        manifestPath: paths.manifestPath,
        scopeId: paths.scopeId,
      });

      yield* shutdown.awaitShutdown();
    }),
  );
});

export type ServerMain = typeof serverMain;
export type ServerMainError = ServerError;
