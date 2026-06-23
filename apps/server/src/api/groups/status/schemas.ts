import { Schema } from "effect";
import { ServerControlEndpoint } from "../../../contracts/control";
import { API_VERSION } from "../../../contracts/constants";
import {
  ConfigPath,
  IsoTimestamp,
  ProcessId,
  ScopeId,
  StateDir,
} from "../../../contracts/primitives";
import { ServerStatusState } from "../../../server-runtime/state";

/** Status is the schema-backed local control payload for CLI discovery. */
export class StatusResponse extends Schema.Class<StatusResponse>("StatusResponse")({
  version: Schema.Literal(API_VERSION),
  protocolVersion: Schema.Literal(API_VERSION),
  pid: ProcessId,
  startedAt: IsoTimestamp,
  uptimeMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  state: ServerStatusState,
  configPath: ConfigPath,
  stateDir: StateDir,
  scopeId: ScopeId,
  endpoint: ServerControlEndpoint,
}) {}
