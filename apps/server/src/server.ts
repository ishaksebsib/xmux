import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Path, Scope } from "effect";
import type { ServerError } from "./errors";
import {
  normalizeServerOptions,
  type NormalizedServerOptions,
  type RunXmuxServerOptions,
} from "./options";
import { acquireManifestOwnership } from "./runtime-state/manifest";
import { ensureRuntimeDirectories, resolveRuntimePaths } from "./runtime-state/paths";

/** Shell handles expose only lifecycle facts; owned resources stay scoped. */
export interface ServerShellHandle {
  readonly startedAt: Date;
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

/** Live shell owns paths and manifest files before adapters or DB are introduced. */
export const ServerShellLive = Layer.effect(ServerShell)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    return {
      acquire: (options: NormalizedServerOptions) =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            const startedAt = options.clock.now();
            const paths = yield* resolveRuntimePaths(options);
            yield* ensureRuntimeDirectories(paths);
            yield* acquireManifestOwnership({ paths, startedAt });
            yield* Effect.logInfo("server shell started", {
              startedAt: startedAt.toISOString(),
              manifestPath: paths.manifestPath,
              scopeId: paths.scopeId,
            });
            return { startedAt };
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, pathService),
          ),
          (handle) =>
            Effect.logInfo("server shell stopped", {
              startedAt: handle.startedAt.toISOString(),
            }),
        ),
    };
  }),
);

const NodePlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** Default server layer wires Node filesystem services into the shell. */
export const ServerLive = Layer.provide(ServerShellLive, NodePlatformLive);

/** Program is exported for tests so fake shell layers can avoid real resources. */
export const serverProgram = Effect.fn("server.program")(function* (
  options: RunXmuxServerOptions,
) {
  const normalizedOptions = normalizeServerOptions(options);
  const shell = yield* ServerShell;

  yield* shell.acquire(normalizedOptions);
  yield* normalizedOptions.shutdownSignal;
});

/** Public Effect boundary imported by the CLI foreground server command. */
export const runXmuxServer = (
  options: RunXmuxServerOptions,
): Effect.Effect<void, ServerError> =>
  Effect.scoped(serverProgram(options)).pipe(Effect.provide(ServerLive));
