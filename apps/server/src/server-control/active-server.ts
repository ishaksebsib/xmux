import { Effect } from "effect";
import type { ManifestPath, ProcessId, SessionId, UnixSocketPath } from "../contracts/primitives";
import { ActiveServerError } from "../errors";
import { HostRuntime } from "../platform/host";
import { readServerManifestResult, removeServerManifest } from "./manifest";
import type { ServerRuntimePaths } from "./paths";
import { ServerProbe } from "./ports";

/** Active server details come from manifest plus a reachable control endpoint. */
export interface ActiveServerInfo {
  readonly manifestPath: ManifestPath;
  readonly endpointPath: UnixSocketPath;
  readonly pid: ProcessId;
  readonly pidAlive: boolean;
  readonly sessionId: SessionId;
}

/** Inactive discovery states stay explicit for CLI status/start decisions. */
export type InactiveServerReason =
  | "no-manifest"
  | "invalid-manifest"
  | "wrong-scope"
  | "stale-manifest-removed";

/** Active-server lookup keeps discovery diagnosable without trusting PID liveness. */
export type ActiveServerLookupResult =
  | { readonly _tag: "Active"; readonly active: ActiveServerInfo }
  | { readonly _tag: "Inactive"; readonly reason: InactiveServerReason };

/** Discover whether this scope is actively owned; PID liveness is only a hint. */
export const findActiveServerResult = Effect.fn("server.findActiveServerResult")(function* (
  paths: ServerRuntimePaths,
) {
  const inactive = (reason: InactiveServerReason): ActiveServerLookupResult => ({
    _tag: "Inactive",
    reason,
  });

  const manifestResult = yield* readServerManifestResult(paths.manifestPath);
  if (manifestResult._tag === "NoManifest") return inactive("no-manifest");
  if (manifestResult._tag === "InvalidManifest") return inactive("invalid-manifest");

  const manifest = manifestResult.manifest;
  if (manifest.scopeId !== paths.scopeId) return inactive("wrong-scope");

  const probe = yield* ServerProbe;
  const host = yield* HostRuntime;
  const endpointReachable = yield* probe.isAlive(manifest.endpoint);
  if (endpointReachable) {
    const active: ActiveServerInfo = {
      manifestPath: paths.manifestPath,
      endpointPath: manifest.endpoint.path,
      pid: manifest.pid,
      pidAlive: yield* host.isPidAlive(manifest.pid),
      sessionId: manifest.sessionId,
    };
    const result: ActiveServerLookupResult = { _tag: "Active", active };
    return result;
  }

  yield* Effect.logWarning("removing stale server manifest", {
    manifestPath: paths.manifestPath,
    endpointPath: manifest.endpoint.path,
    pid: manifest.pid,
    pidAlive: yield* host.isPidAlive(manifest.pid),
  });
  yield* removeServerManifest(paths.manifestPath);
  return inactive("stale-manifest-removed");
});

/** Discover whether this scope is actively owned; PID liveness is only a hint. */
export const findActiveServer = Effect.fn("server.findActiveServer")(function* (
  paths: ServerRuntimePaths,
) {
  const result = yield* findActiveServerResult(paths);
  return result._tag === "Active" ? result.active : null;
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
