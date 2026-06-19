import { Schema } from "effect";
import { HttpServerRespondable, HttpServerResponse } from "effect/unstable/http";
import { RESPONSE_VERSION } from "./version";

/** Control errors are schema-backed because clients render them directly. */
export class ApiErrorPayload extends Schema.Class<ApiErrorPayload>("ApiErrorPayload")({
  code: Schema.String,
  message: Schema.String,
}) {}

/** Error envelope keeps non-2xx responses predictable for generated clients. */
export class ApiErrorResponse extends Schema.Class<ApiErrorResponse>("ApiErrorResponse")({
  version: Schema.Literal(RESPONSE_VERSION),
  error: ApiErrorPayload,
}) {}

const encodeError = HttpServerResponse.schemaJson(ApiErrorResponse);

/** Build the stable JSON error envelope as a normal HTTP response. */
export const jsonError = (input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}) =>
  encodeError(
    ApiErrorResponse.make({
      version: RESPONSE_VERSION,
      error: ApiErrorPayload.make({ code: input.code, message: input.message }),
    }),
    { status: input.status },
  );

/** Schema-backed route failure that Effect HTTP can render as JSON. */
export class ApiError extends Schema.TaggedErrorClass<ApiError>()(
  "ApiError",
  {
    status: Schema.Int,
    code: Schema.String,
    message: Schema.String,
  },
) {
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
  readonly code: string;
  readonly message: string;
}): ApiError => ApiError.make(input);
