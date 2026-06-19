import { request as httpRequest } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { HealthResponse } from "../api/groups/system/schemas";
import type { ServerControlEndpoint } from "../options";
import { ServerProbe } from "./server-probe";

const HEALTH_CHECK_TIMEOUT_MS = 250;
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownEffect(HealthResponse);

const decodeHealthBody = (body: string): Effect.Effect<HealthResponse, unknown> =>
  decodeUnknownJson(body).pipe(Effect.flatMap(decodeHealthResponse));

const requestHealth = (socketPath: string): Effect.Effect<HealthResponse, unknown> =>
  Effect.callback<HealthResponse, unknown>((resume) => {
    let settled = false;
    let body = "";
    const resumeOnce = (effect: Effect.Effect<HealthResponse, unknown>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
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
          const statusCode = response.statusCode ?? 0;
          if (statusCode !== 200) {
            resumeOnce(Effect.fail(new Error(`Health check failed with status ${statusCode}.`)));
            return;
          }
          resumeOnce(decodeHealthBody(body));
        });
      },
    );
    const onError = (cause: Error): void => {
      resumeOnce(Effect.fail(cause));
    };
    const onTimeout = (): void => {
      request.destroy();
      resumeOnce(Effect.fail(new Error(`Timed out reaching server socket: ${socketPath}`)));
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

const isAlive = (endpoint: ServerControlEndpoint): Effect.Effect<boolean> =>
  requestHealth(endpoint.path).pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: (health) => health.alive === true,
    }),
  );

export const ServerProbeNodeLive = Layer.succeed(ServerProbe)({
  isAlive,
});
