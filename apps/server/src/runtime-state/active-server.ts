import { Effect } from "effect";
import { ActiveServerError } from "../errors";
import { HostRuntime } from "../runtime/host";
import { readServerManifest, removeServerManifest } from "./manifest";
import type { ServerRuntimePaths } from "./paths";
import { ServerProbe } from "./server-probe";

/** Active server details come from manifest plus a reachable control endpoint. */
export interface ActiveServerInfo {
  readonly manifestPath: string;
  readonly endpointPath: string;
  readonly pid: number;
  readonly pidAlive: boolean;
  readonly sessionId: string;
}

/** Discover whether this scope is actively owned; PID liveness is only a hint. */
export const findActiveServer = Effect.fn("server.findActiveServer")(function* (
  paths: ServerRuntimePaths,
) {
  const manifest = yield* readServerManifest(paths.manifestPath);
  if (manifest === null) return null;
  if (manifest.scopeId !== paths.scopeId) return null;

  const probe = yield* ServerProbe;
  const host = yield* HostRuntime;
  const endpointReachable = yield* probe.isAlive(manifest.endpoint);
  if (endpointReachable) {
    return {
      manifestPath: paths.manifestPath,
      endpointPath: manifest.endpoint.path,
      pid: manifest.pid,
      pidAlive: yield* host.isPidAlive(manifest.pid),
      sessionId: manifest.sessionId,
    };
  }

  yield* Effect.logWarning("removing stale server manifest", {
    manifestPath: paths.manifestPath,
    endpointPath: manifest.endpoint.path,
    pid: manifest.pid,
    pidAlive: yield* host.isPidAlive(manifest.pid),
  });
  yield* removeServerManifest(paths.manifestPath);
  return null;
});

/** Fail startup if a manifest points at a reachable local control endpoint. */
export const assertNoActiveServer = Effect.fn("server.assertNoActiveServer")(function* (
  paths: ServerRuntimePaths,
) {
  const active = yield* findActiveServer(paths);
  if (active === null) return;
  return yield* ActiveServerError.make({
    manifestPath: active.manifestPath,
    endpointPath: active.endpointPath,
    pid: active.pid,
    sessionId: active.sessionId,
    message: `Another server is already active for this scope at ${active.endpointPath}`,
  });
});
