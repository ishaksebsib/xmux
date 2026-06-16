import { Effect } from "effect";
import { CONTROL_PROTOCOL_VERSION, ManifestEndpoint } from "../contracts/manifest";
import {
  CONTROL_RESPONSE_VERSION,
  HealthResponse,
  ShutdownResponse,
  StatusResponse,
  type ServerStatusState,
} from "../contracts/control";
import type { ServerClock } from "../options";
import type { ServerRuntimePaths } from "../runtime-state/paths";
import { ShutdownCoordinator } from "../runtime/shutdown-coordinator";
import { StatusRegistry } from "../runtime/status-registry";
import { errorResponse, routeResponse, type ControlRouteResult } from "./response";

/** Router input is plain data so the Node control server stays thin. */
export interface ControlRouteInput {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly paths: ServerRuntimePaths;
  readonly startedAt: Date;
  readonly clock: ServerClock;
}

const parsePathname = (url: string | undefined): string => {
  if (url === undefined) return "/";
  try {
    return new URL(url, "http://xmux.local").pathname;
  } catch {
    return "/";
  }
};

const isReady = (state: string): boolean => state === "ready";

const makeStatusResponse = (
  input: ControlRouteInput,
  state: ServerStatusState,
): StatusResponse | null => {
  if (input.paths.controlEndpoint.kind !== "unix-socket") return null;
  const uptimeMs = Math.max(0, input.clock.now().getTime() - input.startedAt.getTime());

  return new StatusResponse({
    version: CONTROL_RESPONSE_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    pid: process.pid,
    startedAt: input.startedAt.toISOString(),
    uptimeMs,
    state,
    configPath: input.paths.configPath,
    stateDir: input.paths.stateDir,
    scopeId: input.paths.scopeId,
    endpoint: new ManifestEndpoint({
      kind: "unix-socket",
      path: input.paths.controlEndpoint.path,
    }),
  });
};

/** Route local control requests without binding the router to Node's response API. */
export const routeControlRequest = Effect.fn("server.routeControlRequest")(function* (
  input: ControlRouteInput,
) {
  const status = yield* StatusRegistry;
  const shutdown = yield* ShutdownCoordinator;
  const method = input.method?.toUpperCase() ?? "GET";
  const pathname = parsePathname(input.url);

  if (pathname === "/healthz" && method === "GET") {
    const state = yield* status.getState;
    return routeResponse(
      200,
      new HealthResponse({
        alive: true,
        ready: isReady(state),
        state,
      }),
    );
  }

  if (pathname === "/v1/status" && method === "GET") {
    const state = yield* status.getState;
    const response = makeStatusResponse(input, state);
    if (response === null) {
      return errorResponse(500, "unsupported_endpoint", "Status requires a Unix socket endpoint.");
    }
    return routeResponse(200, response);
  }

  if (pathname === "/v1/shutdown" && method === "POST") {
    const result = yield* shutdown.beginShutdown;
    if (result.accepted) {
      yield* status.setState("stopping");
    }
    const routeResult: ControlRouteResult = {
      response: {
        statusCode: 202,
        body: new ShutdownResponse({
          accepted: result.accepted,
          alreadyStopping: result.alreadyStopping,
        }),
      },
      afterResponse: result.accepted ? shutdown.completeShutdown : Effect.void,
    };
    return routeResult;
  }

  if (pathname === "/healthz" || pathname === "/v1/status" || pathname === "/v1/shutdown") {
    return errorResponse(405, "method_not_allowed", `Unsupported method: ${method}`);
  }

  return errorResponse(404, "not_found", `Unknown route: ${pathname}`);
});
