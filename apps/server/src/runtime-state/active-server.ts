import { request as httpRequest } from "node:http";
import { Effect, Option, Schema } from "effect";
import { HealthResponse } from "../contracts/control";
import { ActiveServerError } from "../errors";
import { readServerManifest, removeServerManifest } from "./manifest";
import type { ServerRuntimePaths } from "./paths";
import { isPidAlive } from "./pid";

const HEALTH_CHECK_TIMEOUT_MS = 250;
const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownOption(HealthResponse);

/** Active server details come from manifest plus a reachable control endpoint. */
export interface ActiveServerInfo {
  readonly manifestPath: string;
  readonly endpointPath: string;
  readonly pid: number;
  readonly pidAlive: boolean;
  readonly sessionId: string;
}

const decodeHealth = (raw: string): HealthResponse | null => {
  const json = decodeUnknownJsonOption(raw);
  if (Option.isNone(json)) return null;
  const decoded = decodeHealthResponse(json.value);
  return Option.isSome(decoded) ? decoded.value : null;
};

const probeHealth = (socketPath: string): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    let settled = false;
    let body = "";
    const resumeOnce = (active: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.succeed(active));
    };
    const request = httpRequest(
      {
        method: "GET",
        path: "/healthz",
        socketPath,
        timeout: HEALTH_CHECK_TIMEOUT_MS,
      },
      (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body = `${body}${chunk}`;
        });
        response.on("end", () => {
          const health = decodeHealth(body);
          resumeOnce((response.statusCode ?? 0) < 500 && health?.alive === true);
        });
      },
    );
    const onError = (): void => {
      resumeOnce(false);
    };
    const onTimeout = (): void => {
      request.destroy();
      resumeOnce(false);
    };
    const cleanup = (): void => {
      request.off("error", onError);
      request.off("timeout", onTimeout);
    };

    request.once("error", onError);
    request.once("timeout", onTimeout);
    request.end();

    return Effect.sync(() => {
      cleanup();
      request.destroy();
    });
  });

/** Discover whether this scope is actively owned; PID liveness is only a hint. */
export const findActiveServer = Effect.fn("server.findActiveServer")(function* (
  paths: ServerRuntimePaths,
) {
  if (paths.controlEndpoint.kind !== "unix-socket") return null;

  const manifest = yield* readServerManifest(paths.manifestPath);
  if (manifest === null) return null;
  if (manifest.scopeId !== paths.scopeId) return null;

  const endpointReachable = yield* probeHealth(manifest.endpoint.path);
  if (endpointReachable) {
    return {
      manifestPath: paths.manifestPath,
      endpointPath: manifest.endpoint.path,
      pid: manifest.pid,
      pidAlive: isPidAlive(manifest.pid),
      sessionId: manifest.sessionId,
    };
  }

  yield* Effect.logWarning("removing stale server manifest", {
    manifestPath: paths.manifestPath,
    endpointPath: manifest.endpoint.path,
    pid: manifest.pid,
    pidAlive: isPidAlive(manifest.pid),
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
