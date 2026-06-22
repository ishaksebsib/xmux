import { Effect, FileSystem, Schema } from "effect";
import * as jsonc from "jsonc-parser";
import { ServerFileConfig } from "../contracts/config";
import type { ConfigPath } from "../contracts/primitives";
import { ConfigParseError, ConfigValidationError } from "../errors";

const decodeServerFileConfig = Schema.decodeUnknownEffect(ServerFileConfig);

const formatParseErrors = (errors: readonly jsonc.ParseError[]): string =>
  errors
    .map((error) => `offset ${error.offset}: ${jsonc.printParseErrorCode(error.error)}`)
    .join("; ");

/** Load and schema-validate JSONC config; missing files mean empty defaults. */
export const loadServerConfigFile = Effect.fn("server.loadServerConfigFile")(function* (
  configPath: ConfigPath,
) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(configPath).pipe(
    Effect.mapError((cause) =>
      ConfigParseError.make({
        path: configPath,
        message: `Failed to check server config: ${configPath}`,
        cause,
      }),
    ),
  );
  if (!exists) return null;

  const raw = yield* fs.readFileString(configPath).pipe(
    Effect.mapError((cause) =>
      ConfigParseError.make({
        path: configPath,
        message: `Failed to read server config: ${configPath}`,
        cause,
      }),
    ),
  );

  const parseErrors: jsonc.ParseError[] = [];
  const parsed: unknown = jsonc.parse(raw, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    return yield* ConfigParseError.make({
      path: configPath,
      message: formatParseErrors(parseErrors),
    });
  }

  return yield* decodeServerFileConfig(parsed).pipe(
    Effect.mapError((cause) =>
      ConfigValidationError.make({
        path: configPath,
        message: cause.issue.toString(),
        cause,
      }),
    ),
  );
});
