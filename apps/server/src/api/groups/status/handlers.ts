import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ServerControlEndpoint } from "../../../contracts/control";
import { API_VERSION } from "../../../contracts/constants";
import { OrchestratorStatusRegistry } from "../../../orchestrator/status-registry";
import { RuntimePaths } from "../../../server-control/paths";
import { ServerIdentity } from "../../../server-runtime/identity";
import { StatusRegistry } from "../../../server-runtime/state";
import { serverApi } from "../../api";
import { StatusResponse } from "./schemas";

export const status = Effect.fn("api.status.get")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const registry = yield* StatusRegistry;
  const orchestratorRegistry = yield* OrchestratorStatusRegistry;

  const state = yield* registry.getState();
  const orchestrator = yield* orchestratorRegistry.get();
  const nowMs = yield* Clock.currentTimeMillis;
  const uptimeMs = Math.max(0, nowMs - identity.startedAt.getTime());

  return StatusResponse.make({
    version: API_VERSION,
    protocolVersion: API_VERSION,
    pid: identity.pid,
    startedAt: identity.startedAtIso,
    uptimeMs,
    state,
    configPath: paths.configPath,
    stateDir: paths.stateDir,
    scopeId: paths.scopeId,
    endpoint: ServerControlEndpoint.make({
      kind: "unix-socket",
      path: paths.controlEndpoint.path,
    }),
    orchestrator,
  });
});

export const statusHandlerLayer = HttpApiBuilder.group(serverApi, "status", (handlers) =>
  handlers.handle("status", () => status()),
);
