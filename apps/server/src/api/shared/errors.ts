import { Schema } from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/unstable/http";
import { API_VERSION } from "../../contracts/constants";

export const ApiErrorCode = Schema.Literals(["config_unavailable", "log_read_failed"]);
export type ApiErrorCode = typeof ApiErrorCode.Type;

/** Control errors are schema-backed because clients render them directly. */
export class ApiErrorPayload extends Schema.Class<ApiErrorPayload>("ApiErrorPayload")({
  code: ApiErrorCode,
  message: Schema.String,
}) {}

/** Error envelope keeps non-2xx responses predictable for API consumers. */
export class ApiErrorResponse extends Schema.Class<ApiErrorResponse>("ApiErrorResponse")({
  version: Schema.Literal(API_VERSION),
  error: ApiErrorPayload,
}) {}

const encodeError = HttpServerResponse.schemaJson(ApiErrorResponse);

/** Build the stable JSON error envelope as a normal HTTP response. */
export const jsonError = (input: {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
}) =>
  encodeError(
    ApiErrorResponse.make({
      version: API_VERSION,
      error: ApiErrorPayload.make({ code: input.code, message: input.message }),
    }),
    { status: input.status },
  );

/** Schema-backed route failure that Effect HTTP can render as JSON. */
export class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(400)).check(
    Schema.isLessThanOrEqualTo(599),
  ),
  code: ApiErrorCode,
  message: Schema.String,
}) {
  [HttpServerRespondable.symbol]() {
    return jsonError({
      status: this.status,
      code: this.code,
      message: this.message,
    });
  }
}

export const apiError = (input: {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
}): ApiError => ApiError.make(input);
