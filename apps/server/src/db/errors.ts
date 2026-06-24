import { Schema } from "effect";

/** Database open/PRAGMA failures are typed at the server startup boundary. */
export class DatabaseStartupError extends Schema.TaggedErrorClass<DatabaseStartupError>()(
  "DatabaseStartupError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** Migration failures are kept separate from generic startup failures for diagnosis. */
export class DatabaseMigrationError extends Schema.TaggedErrorClass<DatabaseMigrationError>()(
  "DatabaseMigrationError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
