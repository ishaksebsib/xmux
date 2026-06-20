import { request as httpRequest } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { HealthResponse } from "../api/groups/system/schemas";
import type { ServerControlEndpoint } from "./paths";
import { ServerProbe } from "./server-probe";

const HEALTH_CHECK_TIMEOUT_MS = 250;
class ServerProbeRequestError extends Schema.TaggedErrorClass<ServerProbeRequestError>()(
  "ServerProbeRequestError",
  {
    socketPath: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownEffect(HealthResponse);

const decodeHealthBody = (
  socketPath: string,
  body: string,
): Effect.Effect<HealthResponse, ServerProbeRequestError> =>
  decodeUnknownJson(body).pipe(
    Effect.flatMap(decodeHealthResponse),
    Effect.mapError(
      (cause) =>
        new ServerProbeRequestError({
          socketPath,
          message: "Failed to decode health response.",
          cause,
        }),
    ),
  );

const requestHealth = (
  socketPath: string,
): Effect.Effect<HealthResponse, ServerProbeRequestError> =>
  Effect.callback<HealthResponse, ServerProbeRequestError>((resume) => {
    let settled = false;
    let body = "";
    const resumeOnce = (effect: Effect.Effect<HealthResponse, ServerProbeRequestError>): void => {
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
            resumeOnce(
              Effect.fail(
                new ServerProbeRequestError({
                  socketPath,
                  message: `Health check failed with status ${statusCode}.`,
                }),
              ),
            );
            return;
          }
          resumeOnce(decodeHealthBody(socketPath, body));
        });
      },
    );
    const onError = (cause: Error): void => {
      resumeOnce(
        Effect.fail(
          new ServerProbeRequestError({
            socketPath,
            message: "Health check request failed.",
            cause,
          }),
        ),
      );
    };
    const onTimeout = (): void => {
      request.destroy();
      resumeOnce(
        Effect.fail(
          new ServerProbeRequestError({
            socketPath,
            message: "Timed out reaching server socket.",
          }),
        ),
      );
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
