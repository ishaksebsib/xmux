import { Schema } from "effect";
import { CONTROL_PROTOCOL_VERSION, ManifestEndpoint } from "./manifest";

/** Control response version lets clients reject incompatible payload shapes. */
export const CONTROL_RESPONSE_VERSION = 1;

/** Runtime states are intentionally coarse so early control routes stay stable. */
export const ServerStatusState = Schema.Literals([
  "starting",
  "ready",
  "degraded",
  "reloading",
  "stopping",
  "failed",
]);
export type ServerStatusState = typeof ServerStatusState.Type;

/** Health answers whether the process is alive and whether runtime is ready. */
export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  alive: Schema.Boolean,
  ready: Schema.Boolean,
  state: ServerStatusState,
}) {}

/** Status is the first schema-backed local control payload for CLI discovery. */
export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  version: Schema.Literal(CONTROL_RESPONSE_VERSION),
  protocolVersion: Schema.Literal(CONTROL_PROTOCOL_VERSION),
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  startedAt: Schema.String,
  uptimeMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  state: ServerStatusState,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpoint: ManifestEndpoint,
}) {}

/** Shutdown responses are idempotent so repeated CLI calls are harmless. */
export class ShutdownResponse extends Schema.Class<ShutdownResponse>("ShutdownResponse")({
  accepted: Schema.Boolean,
  alreadyStopping: Schema.Boolean,
}) {}

/** Control errors are schema-backed because clients render them directly. */
export class ControlErrorPayload extends Schema.Class<ControlErrorPayload>(
  "ControlErrorPayload",
)({
  code: Schema.String,
  message: Schema.String,
}) {}

/** Error envelope keeps non-2xx responses predictable for future clients. */
export class ControlErrorResponse extends Schema.Class<ControlErrorResponse>(
  "ControlErrorResponse",
)({
  version: Schema.Literal(CONTROL_RESPONSE_VERSION),
  error: ControlErrorPayload,
}) {}
