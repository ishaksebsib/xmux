import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { LogsResponse } from "../../contracts/logs";

export const LogsQuery = Schema.Struct({
  tail: Schema.optional(Schema.String),
});

/** Bounded server diagnostics endpoints. */
export const LogsApi = HttpApiGroup.make("logs").add(
  HttpApiEndpoint.get("tail", "/v1/logs", {
    query: LogsQuery,
    success: LogsResponse,
  }),
);
