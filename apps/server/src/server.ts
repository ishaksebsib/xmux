import { randomUUID } from "node:crypto";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Path, Scope } from "effect";
import { ServerConfig, ServerConfigLive } from "./config/service";
import { SecretResolverLive } from "./config/resolve-secrets";
import { bindControlServer } from "./control/server";
import type { ServerError } from "./errors";
import {
  normalizeServerOptions,
  type NormalizedServerOptions,
  type RunXmuxServerOptions,
} from "./options";
import { assertNoActiveServer } from "./runtime-state/active-server";
import { acquireManifestOwnership } from "./runtime-state/manifest";
import { ensureRuntimeDirectories, resolveRuntimePaths } from "./runtime-state/paths";
import { withStartupLock } from "./runtime-state/startup-lock";
import { ShutdownCoordinator, ShutdownCoordinatorLive } from "./runtime/shutdown-coordinator";
import { StatusRegistry, StatusRegistryLive } from "./runtime/status-registry";

/** Shell handles expose only lifecycle facts; owned resources stay scoped. */
export interface ServerShellHandle {
  readonly startedAt: Date;
  readonly shutdownSignal: Effect.Effect<void>;
}

/** ServerShell isolates process ownership from future runtime graph creation. */
export class ServerShell extends Context.Service<
  ServerShell,
  {
    readonly acquire: (
      options: NormalizedServerOptions,
    ) => Effect.Effect<ServerShellHandle, ServerError, Scope.Scope>;
  }
>()("@xmux/server/ServerShell") {}

/** Live shell owns paths, lock, control socket, and manifest before runtime graph work. */
export const ServerShellLive = Layer.effect(ServerShell)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const status = yield* StatusRegistry;
    const shutdown = yield* ShutdownCoordinator;
    const config = yield* ServerConfig;

    return {
      acquire: (options: NormalizedServerOptions) =>
        Effect.gen(function* () {
          const startedAt = options.clock.now();
          const sessionId = randomUUID();
          const paths = yield* resolveRuntimePaths(options);
          yield* ensureRuntimeDirectories(paths);
          yield* config.loadCurrent(paths.configPath);
          yield* assertNoActiveServer(paths);
          yield* withStartupLock(
            {
              startupLockPath: paths.startupLockPath,
              clock: options.clock,
            },
            Effect.gen(function* () {
              yield* assertNoActiveServer(paths);
              yield* bindControlServer({ paths, startedAt, clock: options.clock });
              yield* acquireManifestOwnership({ paths, startedAt, sessionId });
            }),
          );
          yield* status.setState("ready");
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* status.setState("stopping");
              yield* Effect.logInfo("server shell stopped", {
                startedAt: startedAt.toISOString(),
              });
            }).pipe(Effect.ignore),
          );
          yield* Effect.logInfo("server shell started", {
            startedAt: startedAt.toISOString(),
            manifestPath: paths.manifestPath,
            scopeId: paths.scopeId,
          });
          return { startedAt, shutdownSignal: shutdown.awaitShutdown };
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.provideService(StatusRegistry, status),
          Effect.provideService(ShutdownCoordinator, shutdown),
          Effect.provideService(ServerConfig, config),
        ),
    };
  }),
);

const NodePlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const ServerConfigWithPlatformLive = Layer.provide(
  ServerConfigLive,
  Layer.mergeAll(NodePlatformLive, SecretResolverLive),
);
const ServerServicesLive = Layer.mergeAll(
  StatusRegistryLive,
  ShutdownCoordinatorLive,
  ServerConfigWithPlatformLive,
);

/** Default server layer wires Node platform and lifecycle services into the shell. */
export const ServerLive = Layer.provide(
  ServerShellLive,
  Layer.mergeAll(NodePlatformLive, ServerServicesLive),
);

/** Program is exported for tests so fake shell layers can avoid real resources. */
export const serverProgram = Effect.fn("server.program")(function* (
  options: RunXmuxServerOptions,
) {
  const normalizedOptions = normalizeServerOptions(options);
  const shell = yield* ServerShell;

  const handle = yield* shell.acquire(normalizedOptions);
  yield* Effect.race(normalizedOptions.shutdownSignal, handle.shutdownSignal);
});

/** Public Effect boundary imported by the CLI foreground server command. */
export const runXmuxServer = (
  options: RunXmuxServerOptions,
): Effect.Effect<void, ServerError> =>
  Effect.scoped(serverProgram(options)).pipe(Effect.provide(ServerLive));
