import { Schema } from "effect";
import { ServerControlEndpoint } from "../../../contracts/control";
import { API_VERSION } from "../../../contracts/constants";
import { ServerStatusState } from "../../../server-runtime/state";

/** Status is the schema-backed local control payload for CLI discovery. */
export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  version: Schema.Literal(API_VERSION),
  protocolVersion: Schema.Literal(API_VERSION),
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  startedAt: Schema.String,
  uptimeMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  state: ServerStatusState,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpoint: ServerControlEndpoint,
}) {}
