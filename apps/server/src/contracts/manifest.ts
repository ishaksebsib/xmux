import { Schema } from "effect";
import { ServerControlEndpoint } from "./control";
import { API_VERSION, SERVER_MANIFEST_VERSION } from "./constants";
import { NonEmptyString, PositiveInteger } from "./primitives";

/** Owner metadata helps users identify which binary wrote the manifest. */
export class ServerOwnerMetadata extends Schema.Class<ServerOwnerMetadata>("ServerOwnerMetadata")({
  client: NonEmptyString,
  version: NonEmptyString,
  executablePath: NonEmptyString,
}) {}

/** Active-server manifest is schema-backed because the CLI reads it as untrusted JSON. */
export class ServerManifest extends Schema.Class<ServerManifest>("ServerManifest")({
  version: Schema.Literal(SERVER_MANIFEST_VERSION),
  protocolVersion: Schema.Literal(API_VERSION),
  pid: PositiveInteger,
  sessionId: NonEmptyString,
  startedAt: NonEmptyString,
  configPath: NonEmptyString,
  stateDir: NonEmptyString,
  scopeId: NonEmptyString,
  endpoint: ServerControlEndpoint,
  owner: ServerOwnerMetadata,
}) {}
