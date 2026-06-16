import { Schema } from "effect";

export class ServerStartupError extends Schema.TaggedErrorClass<ServerStartupError>()(
  "ServerStartupError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class ServerShutdownError extends Schema.TaggedErrorClass<ServerShutdownError>()(
  "ServerShutdownError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type ServerError = ServerStartupError | ServerShutdownError;
