import { request as httpRequest } from "node:http";
import { Effect, Option, Schema } from "effect";
import {
  ConfigValidateResponse,
  EffectiveConfigResponse,
} from "../../src/api/groups/config/schemas";
import { ShutdownResponse } from "../../src/api/groups/lifecycle/schemas";
import { LogsResponse } from "../../src/api/groups/log/schemas";
import { StatusResponse } from "../../src/api/groups/status/schemas";
import { HealthResponse } from "../../src/api/groups/system/schemas";

export interface TestHttpResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Record<string, string | readonly string[] | undefined>;
}

export class UnixSocketRequestError extends Schema.TaggedErrorClass<UnixSocketRequestError>()(
  "UnixSocketRequestError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

export const requestUnix = (input: {
  readonly socketPath: string;
  readonly method: "GET" | "POST" | "DELETE" | "PATCH";
  readonly path: string;
  readonly body?: string;
  readonly timeoutMs?: number;
}): Effect.Effect<TestHttpResponse, UnixSocketRequestError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<TestHttpResponse>((resolve, reject) => {
        const request = httpRequest(
          { method: input.method, path: input.path, socketPath: input.socketPath },
          (response) => {
            const chunks: Array<string> = [];
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                statusCode: response.statusCode ?? 0,
                body: chunks.join(""),
                headers: response.headers,
              }),
            );
          },
        );
        request.setTimeout(input.timeoutMs ?? 2_000, () => {
          request.destroy(
            new Error(
              `Unix socket request timed out after ${input.timeoutMs ?? 2_000}ms: ${input.method} ${input.path}`,
            ),
          );
        });
        request.on("error", reject);
        if (input.body !== undefined) request.write(input.body);
        request.end();
      }),
    catch: (cause) => new UnixSocketRequestError({ message: "Unix socket request failed", cause }),
  });

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownOption(HealthResponse);
const decodeStatusResponse = Schema.decodeUnknownOption(StatusResponse);
const decodeEffectiveConfigResponse = Schema.decodeUnknownOption(EffectiveConfigResponse);
const decodeConfigValidateResponse = Schema.decodeUnknownOption(ConfigValidateResponse);
const decodeLogsResponse = Schema.decodeUnknownOption(LogsResponse);
const decodeShutdownResponse = Schema.decodeUnknownOption(ShutdownResponse);

const json = (body: string): unknown => {
  const decoded = decodeJson(body);
  if (Option.isNone(decoded)) throw new Error(`Expected JSON response: ${body}`);
  return decoded.value;
};

export const decodeHealth = (body: string): HealthResponse => {
  const decoded = decodeHealthResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed health schema decode: ${body}`);
  return decoded.value;
};
export const decodeStatus = (body: string): StatusResponse => {
  const decoded = decodeStatusResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed status schema decode: ${body}`);
  return decoded.value;
};
export const decodeEffectiveConfig = (body: string): EffectiveConfigResponse => {
  const decoded = decodeEffectiveConfigResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed config schema decode: ${body}`);
  return decoded.value;
};
export const decodeConfigValidate = (body: string): ConfigValidateResponse => {
  const decoded = decodeConfigValidateResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed validate schema decode: ${body}`);
  return decoded.value;
};
export const decodeLogs = (body: string): LogsResponse => {
  const decoded = decodeLogsResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed logs schema decode: ${body}`);
  return decoded.value;
};
export const decodeShutdown = (body: string): ShutdownResponse => {
  const decoded = decodeShutdownResponse(json(body));
  if (Option.isNone(decoded)) throw new Error(`Response failed shutdown schema decode: ${body}`);
  return decoded.value;
};

export const getHealth = (
  socketPath: string,
): Effect.Effect<HealthResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "GET", path: "/healthz" }).pipe(
    Effect.map((r) => decodeHealth(r.body)),
  );
export const getStatus = (
  socketPath: string,
): Effect.Effect<StatusResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "GET", path: "/v1/status" }).pipe(
    Effect.map((r) => decodeStatus(r.body)),
  );
export const getEffectiveConfig = (
  socketPath: string,
): Effect.Effect<EffectiveConfigResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "GET", path: "/v1/config/effective" }).pipe(
    Effect.map((r) => decodeEffectiveConfig(r.body)),
  );
export const validateConfig = (
  socketPath: string,
): Effect.Effect<ConfigValidateResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "POST", path: "/v1/config/validate" }).pipe(
    Effect.map((r) => decodeConfigValidate(r.body)),
  );
export const tailLogs = (
  socketPath: string,
  tail = 20,
): Effect.Effect<LogsResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "GET", path: `/v1/logs?tail=${tail}` }).pipe(
    Effect.map((r) => decodeLogs(r.body)),
  );
export const requestShutdown = (
  socketPath: string,
): Effect.Effect<ShutdownResponse, UnixSocketRequestError> =>
  requestUnix({ socketPath, method: "POST", path: "/v1/shutdown" }).pipe(
    Effect.map((r) => decodeShutdown(r.body)),
  );
