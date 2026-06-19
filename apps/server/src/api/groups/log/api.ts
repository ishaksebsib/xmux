import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { LogsQuery, LogsResponse } from "./schemas";

/** Bounded server diagnostics endpoints. */
export const logsApi = HttpApiGroup.make("logs").add(
  HttpApiEndpoint.get("tail", "/v1/logs", {
    query: LogsQuery,
    success: LogsResponse,
  }),
);
