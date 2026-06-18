import { Schema } from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/unstable/http";
import { ConfigValidateResponse, EffectiveConfigResponse } from "../contracts/config";
import {
  CONTROL_RESPONSE_VERSION,
  ControlErrorPayload,
  ControlErrorResponse,
  HealthResponse,
  ShutdownResponse,
  StatusResponse,
} from "../contracts/control";
import { LogsResponse } from "../contracts/logs";

export const healthJson = HttpServerResponse.schemaJson(HealthResponse);
export const statusJson = HttpServerResponse.schemaJson(StatusResponse);
export const shutdownJson = HttpServerResponse.schemaJson(ShutdownResponse);
export const effectiveConfigJson = HttpServerResponse.schemaJson(EffectiveConfigResponse);
export const configValidateJson = HttpServerResponse.schemaJson(ConfigValidateResponse);
export const logsJson = HttpServerResponse.schemaJson(LogsResponse);

const apiErrorJson = HttpServerResponse.schemaJson(ControlErrorResponse);

/** Build the stable JSON error envelope as a normal HTTP response. */
export const apiErrorResponseJson = (input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}) =>
  apiErrorJson(
    ControlErrorResponse.make({
      version: CONTROL_RESPONSE_VERSION,
      error: ControlErrorPayload.make({ code: input.code, message: input.message }),
    }),
    { status: input.status },
  );

/** Schema-backed route failure that Effect HTTP can render as JSON. */
export class XmuxApiError extends Schema.TaggedErrorClass<XmuxApiError>()(
  "XmuxApiError",
  {
    status: Schema.Int,
    code: Schema.String,
    message: Schema.String,
  },
) {
  [HttpServerRespondable.symbol]() {
    return apiErrorResponseJson({
      status: this.status,
      code: this.code,
      message: this.message,
    });
  }
}

export const makeXmuxApiError = (input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}): XmuxApiError => XmuxApiError.make(input);
