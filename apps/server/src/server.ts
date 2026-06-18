import { NodeFileSystem, NodeHttpServer, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { ServerConfig, ServerConfigLive } from "./config/service";
import { SecretResolverLive } from "./config/resolve-secrets";
import { XmuxHttpServerLive } from "./http/server-node";
import type { ServerError } from "./errors";
import { withFileLogger } from "./logging/file-logger";
import { LogReaderLive } from "./logging/log-reader";
import {
  normalizeServerOptions,
  ServerOptions,
  type NormalizedServerOptions,
  type RunXmuxServerOptions,
} from "./options";
import { ServerIdentity, ServerIdentityLive } from "./runtime/server-identity";
import { ShutdownCoordinator, ShutdownCoordinatorLive } from "./runtime/shutdown-coordinator";
import { StatusRegistry, StatusRegistryLive } from "./runtime/status-registry";
import { assertNoActiveServer } from "./runtime-state/active-server";
import { acquireManifestOwnership } from "./runtime-state/manifest";
import { ensureRuntimeDirectories } from "./runtime-state/paths";
import { RuntimePaths, RuntimePathsLive } from "./runtime-state/runtime-paths-service";
import { ServerProbeNodeLive } from "./runtime-state/server-probe-node";
import { withStartupLock } from "./runtime-state/startup-lock";

const NodePlatformLive = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeHttpServer.layerHttpServices,
);

const ServerConfigWithPlatformLive = Layer.provide(
  ServerConfigLive,
  Layer.mergeAll(NodePlatformLive, SecretResolverLive),
);

const LogReaderWithPlatformLive = Layer.provide(LogReaderLive, NodePlatformLive);

const ServerServicesLive = Layer.mergeAll(
  StatusRegistryLive,
  ShutdownCoordinatorLive,
  ServerConfigWithPlatformLive,
  LogReaderWithPlatformLive,
  ServerProbeNodeLive,
);

/** Compose the live server dependency graph once for a normalized option set. */
export const makeServerLive = (options: NormalizedServerOptions) => {
  const ServerOptionsLive = Layer.succeed(ServerOptions)(options);
  const CoreLive = Layer.mergeAll(NodePlatformLive, ServerOptionsLive);
  const RuntimePathsReadyLive = Layer.provide(RuntimePathsLive, CoreLive);
  const ServerIdentityReadyLive = Layer.provide(ServerIdentityLive, ServerOptionsLive);

  return Layer.mergeAll(
    CoreLive,
    RuntimePathsReadyLive,
    ServerIdentityReadyLive,
    ServerServicesLive,
  );
};

/** Main server workflow owns startup ordering while services come from context. */
export const serverMain = Effect.fn("server.main")(function* () {
  const options = yield* ServerOptions;
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const config = yield* ServerConfig;
  const status = yield* StatusRegistry;
  const shutdown = yield* ShutdownCoordinator;

  yield* ensureRuntimeDirectories(paths);
  const effectiveConfig = yield* config.loadCurrent(paths.configPath);

  return yield* withFileLogger(
    { logDir: paths.logDir, logLevel: effectiveConfig.server.logLevel },
    Effect.gen(function* () {
      yield* assertNoActiveServer(paths);

      yield* withStartupLock(
        { startupLockPath: paths.startupLockPath, clock: options.clock },
        Effect.gen(function* () {
          yield* assertNoActiveServer(paths);
          yield* Layer.build(XmuxHttpServerLive);
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

      yield* Effect.race(options.shutdownSignal, shutdown.awaitShutdown);
    }),
  );
});

/** Program is exported for tests while public callers use runXmuxServer. */
export const serverProgram = Effect.fn("server.program")(function* (
  options: RunXmuxServerOptions,
) {
  const normalizedOptions = normalizeServerOptions(options);
  return yield* serverMain().pipe(Effect.provide(makeServerLive(normalizedOptions)));
});

/** Public Effect boundary for use by clients. */
export const runXmuxServer = (
  options: RunXmuxServerOptions,
): Effect.Effect<void, ServerError> => Effect.scoped(serverProgram(options));
