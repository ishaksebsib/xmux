import { Schema } from "effect";
import { CliControlOperation } from "./input";

const OptionalSafeText = Schema.optionalKey(Schema.String);
const OptionalCause = Schema.optionalKey(Schema.Defect());

export class CliDiscoveryError extends Schema.TaggedErrorClass<CliDiscoveryError>()(
  "CliDiscoveryError",
  {
    message: Schema.String,
    reason: OptionalSafeText,
    cause: OptionalCause,
  },
) {}

export class CliServerNotRunning extends Schema.TaggedErrorClass<CliServerNotRunning>()(
  "CliServerNotRunning",
  {
    message: Schema.String,
    reason: OptionalSafeText,
    manifestPath: OptionalSafeText,
    socketPath: OptionalSafeText,
  },
) {}

export class CliServerUnreachable extends Schema.TaggedErrorClass<CliServerUnreachable>()(
  "CliServerUnreachable",
  {
    message: Schema.String,
    socketPath: OptionalSafeText,
    operation: Schema.optionalKey(CliControlOperation),
    cause: OptionalCause,
  },
) {}

export const CliWaitOperation = Schema.Literals(["start", "stop", "restart"]);
export type CliWaitOperation = typeof CliWaitOperation.Type;

export const CliLifecycleBlockReason = Schema.Literals(["invalid-manifest", "wrong-scope"]);
export type CliLifecycleBlockReason = typeof CliLifecycleBlockReason.Type;

export class CliWaitTimeout extends Schema.TaggedErrorClass<CliWaitTimeout>()("CliWaitTimeout", {
  message: Schema.String,
  operation: CliWaitOperation,
  timeoutMs: Schema.Number,
  socketPath: OptionalSafeText,
}) {}

export class CliSpawnError extends Schema.TaggedErrorClass<CliSpawnError>()("CliSpawnError", {
  message: Schema.String,
  command: OptionalSafeText,
  cause: OptionalCause,
}) {}

export class CliLifecycleBlocked extends Schema.TaggedErrorClass<CliLifecycleBlocked>()(
  "CliLifecycleBlocked",
  {
    message: Schema.String,
    operation: CliWaitOperation,
    reason: CliLifecycleBlockReason,
    configPath: OptionalSafeText,
    manifestPath: OptionalSafeText,
    socketPath: OptionalSafeText,
  },
) {}

export class CliInvalidInput extends Schema.TaggedErrorClass<CliInvalidInput>()("CliInvalidInput", {
  message: Schema.String,
  field: OptionalSafeText,
  cause: OptionalCause,
}) {}

export class CliControlRequestError extends Schema.TaggedErrorClass<CliControlRequestError>()(
  "CliControlRequestError",
  {
    message: Schema.String,
    operation: CliControlOperation,
    socketPath: OptionalSafeText,
    cause: OptionalCause,
  },
) {}

export class CliServerRunFailed extends Schema.TaggedErrorClass<CliServerRunFailed>()(
  "CliServerRunFailed",
  {
    message: Schema.String,
    reason: OptionalSafeText,
    cause: OptionalCause,
  },
) {}

export const CliError = Schema.Union([
  CliDiscoveryError,
  CliServerNotRunning,
  CliServerUnreachable,
  CliWaitTimeout,
  CliSpawnError,
  CliLifecycleBlocked,
  CliInvalidInput,
  CliControlRequestError,
  CliServerRunFailed,
]);
export type CliError = typeof CliError.Type;
