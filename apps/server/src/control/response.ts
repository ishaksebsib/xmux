import type { ServerResponse } from "node:http";
import { Effect } from "effect";
import {
  CONTROL_RESPONSE_VERSION,
  ControlErrorPayload,
  ControlErrorResponse,
  type HealthResponse,
  type ShutdownResponse,
  type StatusResponse,
} from "../contracts/control";

/** Control bodies are schema-backed DTOs; transport metadata stays separate. */
export type ControlResponseBody =
  | HealthResponse
  | StatusResponse
  | ShutdownResponse
  | ControlErrorResponse;

/** HTTP response wrapper keeps router logic independent from Node's API. */
export interface ControlHttpResponse {
  readonly statusCode: number;
  readonly body: ControlResponseBody;
}

/** Route result can schedule work after the response has flushed. */
export interface ControlRouteResult {
  readonly response: ControlHttpResponse;
  readonly afterResponse: Effect.Effect<void>;
}

/** Create a JSON route result with no post-response work. */
export const routeResponse = (
  statusCode: number,
  body: ControlResponseBody,
): ControlRouteResult => ({
  response: { statusCode, body },
  afterResponse: Effect.void,
});

/** Error responses use one envelope so CLI output can be consistent. */
export const errorResponse = (
  statusCode: number,
  code: string,
  message: string,
): ControlRouteResult =>
  routeResponse(
    statusCode,
    ControlErrorResponse.make({
      version: CONTROL_RESPONSE_VERSION,
      error: ControlErrorPayload.make({ code, message }),
    }),
  );

/** Write completion is an Effect so shutdown can wait until bytes are flushed. */
export const writeControlResponse = (
  response: ServerResponse,
  controlResponse: ControlHttpResponse,
): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const body = `${JSON.stringify(controlResponse.body)}\n`;
    const onError = (): void => {
      cleanup();
      resume(Effect.void);
    };
    const cleanup = (): void => {
      response.off("error", onError);
    };

    response.once("error", onError);
    try {
      response.writeHead(controlResponse.statusCode, {
        "content-length": Buffer.byteLength(body).toString(),
        "content-type": "application/json; charset=utf-8",
      });
      response.end(body, () => {
        cleanup();
        resume(Effect.void);
      });
    } catch {
      cleanup();
      resume(Effect.void);
    }

    return Effect.sync(cleanup);
  });
