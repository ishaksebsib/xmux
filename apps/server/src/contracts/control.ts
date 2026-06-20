import { Schema } from "effect";
import { NonEmptyString } from "./primitives";

/** Local-only control endpoint used by manifests, status, probes, and clients. */
export class ServerControlEndpoint extends Schema.Class<ServerControlEndpoint>(
  "ServerControlEndpoint",
)({
  kind: Schema.Literal("unix-socket"),
  path: NonEmptyString,
}) {}
