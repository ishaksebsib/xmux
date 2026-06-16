import { Schema } from "effect";

/** Manifest file version gates future shape changes without guessing. */
export const SERVER_MANIFEST_VERSION = 1;

/** Control protocol version lets old CLIs reject incompatible servers. */
export const CONTROL_PROTOCOL_VERSION = 1;

/** Local-only endpoint stored in manifests for CLI discovery. */
export class ManifestEndpoint extends Schema.Class<ManifestEndpoint>("ManifestEndpoint")({
  kind: Schema.Literal("unix-socket"),
  path: Schema.String,
}) {}

/** Owner metadata helps users identify which binary wrote the manifest. */
export class ServerOwnerMetadata extends Schema.Class<ServerOwnerMetadata>(
  "ServerOwnerMetadata",
)({
  client: Schema.String,
  version: Schema.String,
  executablePath: Schema.String,
}) {}

/** Active-server manifest is schema-backed because the CLI reads it as untrusted JSON. */
export class ServerManifest extends Schema.Class<ServerManifest>("ServerManifest")({
  version: Schema.Literal(SERVER_MANIFEST_VERSION),
  protocolVersion: Schema.Literal(CONTROL_PROTOCOL_VERSION),
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  startedAt: Schema.String,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpoint: ManifestEndpoint,
  owner: ServerOwnerMetadata,
}) {}
