import { Schema } from "effect";
import { ServerStatusState } from "../../../server-runtime/state";

/** Health answers whether the process is alive and whether runtime is ready. */
export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  alive: Schema.Boolean,
  ready: Schema.Boolean,
  state: ServerStatusState,
}) {}
