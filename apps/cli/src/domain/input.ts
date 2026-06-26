import { Effect, Option, Schema } from "effect";

export const CliConfigPath = Schema.NonEmptyString.pipe(Schema.brand("@xmux/cli/CliConfigPath"));
export type CliConfigPath = typeof CliConfigPath.Type;

export const CliTailCount = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("@xmux/cli/CliTailCount"),
);
export type CliTailCount = typeof CliTailCount.Type;

export const CliTimeoutMs = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("@xmux/cli/CliTimeoutMs"),
);
export type CliTimeoutMs = typeof CliTimeoutMs.Type;

export const CliPollIntervalMs = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("@xmux/cli/CliPollIntervalMs"),
);
export type CliPollIntervalMs = typeof CliPollIntervalMs.Type;

export const CliOutputMode = Schema.Literals(["human", "json"]);
export type CliOutputMode = typeof CliOutputMode.Type;

export const CliControlOperation = Schema.Literals(["health", "status", "logs", "shutdown"]);
export type CliControlOperation = typeof CliControlOperation.Type;

export class CliServerTarget extends Schema.Class<CliServerTarget>("CliServerTarget")({
  configPath: Schema.optionalKey(CliConfigPath),
}) {}

const decodeConfigPath = Schema.decodeUnknownEffect(CliConfigPath);
const undefinedConfigPath = Effect.sync((): undefined => undefined);
const decodeTailCount = Schema.decodeUnknownEffect(CliTailCount);
const decodeTimeoutMs = Schema.decodeUnknownEffect(CliTimeoutMs);
const decodePollIntervalMs = Schema.decodeUnknownEffect(CliPollIntervalMs);

export const parseConfigPathOption = (
  value: Option.Option<string>,
): Effect.Effect<CliConfigPath | undefined, Schema.SchemaError> =>
  Option.match(value, {
    onNone: () => undefinedConfigPath,
    onSome: decodeConfigPath,
  });

export const parseServerTarget = (
  configPath: Option.Option<string>,
): Effect.Effect<CliServerTarget, Schema.SchemaError> =>
  parseConfigPathOption(configPath).pipe(
    Effect.map((parsed) =>
      parsed === undefined ? new CliServerTarget({}) : new CliServerTarget({ configPath: parsed }),
    ),
  );

export const parseTailCount = (value: number): Effect.Effect<CliTailCount, Schema.SchemaError> =>
  decodeTailCount(value);

export const parseTimeoutMs = (value: number): Effect.Effect<CliTimeoutMs, Schema.SchemaError> =>
  decodeTimeoutMs(value);

export const parsePollIntervalMs = (
  value: number,
): Effect.Effect<CliPollIntervalMs, Schema.SchemaError> => decodePollIntervalMs(value);
