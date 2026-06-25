import { Schema } from "effect";

export class OrchestratorConfigurationError extends Schema.TaggedErrorClass<OrchestratorConfigurationError>()(
  "OrchestratorConfigurationError",
  {
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class OrchestratorStartupError extends Schema.TaggedErrorClass<OrchestratorStartupError>()(
  "OrchestratorStartupError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class OrchestratorShutdownError extends Schema.TaggedErrorClass<OrchestratorShutdownError>()(
  "OrchestratorShutdownError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
