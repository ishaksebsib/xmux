import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ServerControlEndpoint } from "../../../contracts/control";
import { API_VERSION } from "../../../contracts/constants";
import { RuntimePaths } from "../../../server-control/paths";
import { ServerIdentity } from "../../../server-runtime/identity";
import { StatusRegistry } from "../../../server-runtime/state";
import { serverApi } from "../../api";
import { StatusResponse } from "./schemas";

export const status = Effect.fn("api.status.get")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const registry = yield* StatusRegistry;

  const state = yield* registry.getState();
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
  });
});

export const statusHandlerLayer = HttpApiBuilder.group(serverApi, "status", (handlers) =>
  handlers.handle("status", () => status()),
);
