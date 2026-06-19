import { Effect } from "effect";
import { ServerConfig } from "../config/service";
import type { ServerError } from "../errors";
import { withFileLogger } from "../logging/file-logger";
import { ServerIdentity } from "../runtime/server-identity";
import { ShutdownCoordinator } from "../runtime/shutdown-coordinator";
import { StatusRegistry } from "../runtime/status-registry";
import { assertNoActiveServer } from "../runtime-state/active-server";
import { acquireManifestOwnership } from "../runtime-state/manifest";
import { ensureRuntimeDirectories } from "../runtime-state/paths";
import { RuntimePaths } from "../runtime-state/runtime-paths-service";
import { withStartupLock } from "../runtime-state/startup-lock";
import { ServerBinding } from "./binding";

/** Main server workflow owns startup ordering while services come from context. */
export const serverMain = Effect.fn("server.main")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const config = yield* ServerConfig;
  const status = yield* StatusRegistry;
  const shutdown = yield* ShutdownCoordinator;
  const binding = yield* ServerBinding;

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
          yield* binding.bind;
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

      yield* shutdown.awaitShutdown;
    }),
  );
});

export type ServerMain = typeof serverMain;
export type ServerMainError = ServerError;
