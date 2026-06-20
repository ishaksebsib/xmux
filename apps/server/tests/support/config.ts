import { writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";

export class WriteConfigError extends Schema.TaggedErrorClass<WriteConfigError>()(
  "WriteConfigError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

export const minimalConfig = (overrides = ""): string => `{
  "userName": "integration-test",
  "defaultWorkingDirectory": "./workspace"${overrides === "" ? "" : `,\n  ${overrides}`}
}`;

export const validTelegramConfig = (token: string): string => `{
  "userName": "integration-test",
  "defaultWorkingDirectory": "./workspace",
  "chats": { "telegram": { "enabled": true, "token": { "value": "${token}" } } }
}`;

export const missingEnvSecretConfig = (envName: string): string => `{
  "chats": { "telegram": { "enabled": true, "token": { "env": "${envName}" } } }
}`;

export const invalidJsonConfig = "{ invalid json }";
export const invalidLogLevelConfig = `{ "server": { "logLevel": "verbose" } }`;

export const writeConfig = (path: string, content: string): Effect.Effect<void, WriteConfigError> =>
  Effect.tryPromise({
    try: () => writeFile(path, content),
    catch: (cause) =>
      new WriteConfigError({ path, message: `Failed to write config: ${path}`, cause }),
  });
