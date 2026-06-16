import { Schema } from "effect";

/** Server startup failures are public because CLI start/status needs stable labels. */
export class ServerStartupError extends Schema.TaggedErrorClass<ServerStartupError>()(
  "ServerStartupError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Server shutdown failures stay typed so cleanup paths can report safely. */
export class ServerShutdownError extends Schema.TaggedErrorClass<ServerShutdownError>()(
  "ServerShutdownError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Runtime path failures are separate so unsafe local state can stop boot early. */
export class RuntimePathError extends Schema.TaggedErrorClass<RuntimePathError>()(
  "RuntimePathError",
  {
    message: Schema.String,
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Manifest failures identify discovery-file ownership problems at the boundary. */
export class ManifestError extends Schema.TaggedErrorClass<ManifestError>()("ManifestError", {
  operation: Schema.Literals(["write", "remove"]),
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Startup lock failures keep duplicate-server prevention distinguishable. */
export class StartupLockError extends Schema.TaggedErrorClass<StartupLockError>()(
  "StartupLockError",
  {
    operation: Schema.Literals(["acquire", "release"]),
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Control server failures isolate local transport setup from runtime startup. */
export class ControlServerError extends Schema.TaggedErrorClass<ControlServerError>()(
  "ControlServerError",
  {
    operation: Schema.Literals(["bind", "close"]),
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/** Public server failure union for CLI/control surfaces. */
export type ServerError =
  | ServerStartupError
  | ServerShutdownError
  | RuntimePathError
  | ManifestError
  | StartupLockError
  | ControlServerError;
