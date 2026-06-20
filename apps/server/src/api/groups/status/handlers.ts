import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { API_VERSION } from "../../../contracts/constants";
import { ManifestEndpoint } from "../../../contracts/manifest";
import { RuntimePaths } from "../../../runtime-state/runtime-paths-service";
import { ServerIdentity } from "../../../runtime/server-identity";
import { StatusRegistry } from "../../../runtime/status-registry";
import { serverApi } from "../../api";
import { StatusResponse } from "./schemas";

export const status = Effect.fn("api.status.get")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const registry = yield* StatusRegistry;

  const state = yield* registry.getState;
  const nowMs = yield* Clock.currentTimeMillis;
  const uptimeMs = Math.max(0, nowMs - identity.startedAt.getTime());

  return StatusResponse.make({
    version: API_VERSION,
    protocolVersion: API_VERSION,
    pid: identity.pid,
    startedAt: identity.startedAt.toISOString(),
    uptimeMs,
    state,
    configPath: paths.configPath,
    stateDir: paths.stateDir,
    scopeId: paths.scopeId,
    endpoint: ManifestEndpoint.make({
      kind: "unix-socket",
      path: paths.controlEndpoint.path,
    }),
  });
});

export const statusHandlers = HttpApiBuilder.group(serverApi, "status", (handlers) =>
  handlers.handle("status", () => status()),
);
