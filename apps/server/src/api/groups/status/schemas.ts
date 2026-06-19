import { Schema } from "effect";
import { CONTROL_PROTOCOL_VERSION, ManifestEndpoint } from "../../../contracts/manifest";
import { ServerStatusState } from "../../../runtime/status-state";
import { RESPONSE_VERSION } from "../../shared/version";

/** Status is the schema-backed local control payload for CLI discovery. */
export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  version: Schema.Literal(RESPONSE_VERSION),
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
