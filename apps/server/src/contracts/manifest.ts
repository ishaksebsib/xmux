import { Schema } from "effect";
import { API_VERSION, SERVER_MANIFEST_VERSION } from "./constants";

/** Local-only endpoint stored in manifests for CLI discovery. */
export class ManifestEndpoint extends Schema.Class<ManifestEndpoint>("ManifestEndpoint")({
  kind: Schema.Literal("unix-socket"),
  path: Schema.String,
}) {}

/** Owner metadata helps users identify which binary wrote the manifest. */
export class ServerOwnerMetadata extends Schema.Class<ServerOwnerMetadata>("ServerOwnerMetadata")({
  client: Schema.String,
  version: Schema.String,
  executablePath: Schema.String,
}) {}

/** Active-server manifest is schema-backed because the CLI reads it as untrusted JSON. */
export class ServerManifest extends Schema.Class<ServerManifest>("ServerManifest")({
  version: Schema.Literal(SERVER_MANIFEST_VERSION),
  protocolVersion: Schema.Literal(API_VERSION),
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  sessionId: Schema.String,
  startedAt: Schema.String,
  configPath: Schema.String,
  stateDir: Schema.String,
  scopeId: Schema.String,
  endpoint: ManifestEndpoint,
  owner: ServerOwnerMetadata,
}) {}
