import { Clock, Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ServerConfig } from "../config/service";
import { CONTROL_PROTOCOL_VERSION, ManifestEndpoint } from "../contracts/manifest";
import {
  CONTROL_RESPONSE_VERSION,
  HealthResponse,
  ShutdownResponse,
  StatusResponse,
} from "../contracts/control";
import { LogReader } from "../logging/log-reader";
import { RuntimePaths } from "../runtime-state/runtime-paths-service";
import { ServerIdentity } from "../runtime/server-identity";
import { ShutdownCoordinator } from "../runtime/shutdown-coordinator";
import { StatusRegistry } from "../runtime/status-registry";
import { XmuxServerApi } from "./api";
import {
  apiErrorResponseJson,
  configValidateJson,
  effectiveConfigJson,
  healthJson,
  logsJson,
  shutdownJson,
  statusJson,
} from "./responses";

const isReady = (state: string): boolean => state === "ready";

const parseTailParam = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const parseRequestPathname = (url: string): string => {
  try {
    return new URL(url, "http://xmux.local").pathname;
  } catch {
    return "/";
  }
};

const knownRoutePaths = new Set([
  "/healthz",
  "/v1/status",
  "/v1/config/effective",
  "/v1/config/validate",
  "/v1/logs",
  "/v1/shutdown",
]);

export const healthHandler = Effect.fn("api.system.health")(function* () {
  const status = yield* StatusRegistry;
  const state = yield* status.getState;

  return yield* healthJson(
    HealthResponse.make({
      alive: true,
      ready: isReady(state),
      state,
    }),
  ).pipe(Effect.orDie);
});

export const statusHandler = Effect.fn("api.status.status")(function* () {
  const paths = yield* RuntimePaths;
  const identity = yield* ServerIdentity;
  const status = yield* StatusRegistry;

  if (paths.controlEndpoint.kind !== "unix-socket") {
    return yield* apiErrorResponseJson({
      status: 500,
      code: "unsupported_endpoint",
      message: "Status requires a Unix socket endpoint.",
    }).pipe(Effect.orDie);
  }

  const state = yield* status.getState;
  const nowMs = yield* Clock.currentTimeMillis;
  const uptimeMs = Math.max(0, nowMs - identity.startedAt.getTime());

  return yield* statusJson(
    StatusResponse.make({
      version: CONTROL_RESPONSE_VERSION,
      protocolVersion: CONTROL_PROTOCOL_VERSION,
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
    }),
  ).pipe(Effect.orDie);
});

export const effectiveConfigHandler = Effect.fn("api.config.effective")(function* () {
  const config = yield* ServerConfig;
  return yield* config.getRedacted.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        apiErrorResponseJson({
          status: 500,
          code: "config_unavailable",
          message: error.message,
        }).pipe(Effect.orDie),
      onSuccess: (response) => effectiveConfigJson(response).pipe(Effect.orDie),
    }),
  );
});

export const validateConfigHandler = Effect.fn("api.config.validate")(function* () {
  const config = yield* ServerConfig;
  const response = yield* config.validateCurrent;
  return yield* configValidateJson(response, { status: response.valid ? 200 : 422 }).pipe(
    Effect.orDie,
  );
});

export const logsHandler = Effect.fn("api.logs.tail")(function* (tail: string | undefined) {
  const paths = yield* RuntimePaths;
  const logs = yield* LogReader;
  return yield* logs
    .readTail({ logDir: paths.logDir, tail: parseTailParam(tail) })
    .pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          apiErrorResponseJson({
            status: 500,
            code: "log_read_failed",
            message: error.message,
          }).pipe(Effect.orDie),
        onSuccess: (response) => logsJson(response).pipe(Effect.orDie),
      }),
    );
});

export const shutdownHandler = Effect.fn("api.lifecycle.shutdown")(function* () {
  const shutdown = yield* ShutdownCoordinator;
  const status = yield* StatusRegistry;

  const result = yield* shutdown.beginShutdown;
  if (result.accepted) {
    yield* status.setState("stopping");
    yield* Effect.addFinalizer(() => shutdown.completeShutdown);
  }

  return yield* shutdownJson(
    ShutdownResponse.make({
      accepted: result.accepted,
      alreadyStopping: result.alreadyStopping,
    }),
    { status: 202 },
  ).pipe(Effect.orDie);
});

export const fallbackHandler = Effect.fn("api.fallback")(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const pathname = parseRequestPathname(request.url);
  const method = request.method.toUpperCase();

  if (knownRoutePaths.has(pathname)) {
    return yield* apiErrorResponseJson({
      status: 405,
      code: "method_not_allowed",
      message: `Unsupported method: ${method}`,
    }).pipe(Effect.orDie);
  }

  return yield* apiErrorResponseJson({
    status: 404,
    code: "not_found",
    message: `Unknown route: ${pathname}`,
  }).pipe(Effect.orDie);
});

export const SystemHandlers = HttpApiBuilder.group(XmuxServerApi, "system", (handlers) =>
  handlers.handle("health", () => healthHandler()),
);

export const StatusHandlers = HttpApiBuilder.group(XmuxServerApi, "status", (handlers) =>
  handlers.handle("status", () => statusHandler()),
);

export const ConfigHandlers = HttpApiBuilder.group(XmuxServerApi, "config", (handlers) =>
  handlers
    .handle("effective", () => effectiveConfigHandler())
    .handle("validate", () => validateConfigHandler()),
);

export const LogsHandlers = HttpApiBuilder.group(XmuxServerApi, "logs", (handlers) =>
  handlers.handle("tail", ({ query }) => logsHandler(query.tail)),
);

export const LifecycleHandlers = HttpApiBuilder.group(XmuxServerApi, "lifecycle", (handlers) =>
  handlers.handle("shutdown", () => shutdownHandler()),
);

/** Merge all API group handlers once. */
export const XmuxServerHandlers = Layer.mergeAll(
  SystemHandlers,
  StatusHandlers,
  ConfigHandlers,
  LogsHandlers,
  LifecycleHandlers,
);
