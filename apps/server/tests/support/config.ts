import { writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";

export class WriteConfigError extends Schema.TaggedErrorClass<WriteConfigError>()(
  "WriteConfigError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export const minimalConfig = (overrides = ""): string => `{
  "xmux": { "workspace": { "defaultDir": "./workspace" } }${overrides === "" ? "" : `,\n  ${overrides}`}
}`;

export const validTelegramConfig = (token: string): string => `{
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "chats": {
    "telegram": {
      "token": { "value": "${token}" },
      "access": { "type": "anyone" }
    }
  }
}`;

export const missingEnvSecretConfig = (envName: string): string => `{
  "chats": {
    "telegram": {
      "token": { "env": "${envName}" },
      "access": { "type": "anyone" }
    }
  }
}`;

export const invalidJsonConfig = "{ invalid json }";
export const invalidLogLevelConfig = `{ "server": { "logs": { "level": "verbose" } } }`;

export const writeConfig = (path: string, content: string): Effect.Effect<void, WriteConfigError> =>
  Effect.tryPromise({
    try: () => writeFile(path, content),
    catch: (cause) =>
      new WriteConfigError({ path, message: `Failed to write config: ${path}`, cause }),
  });
