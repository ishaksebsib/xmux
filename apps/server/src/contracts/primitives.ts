import { Schema } from "effect";

const isAbsolutePath = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");

const isValidIsoTimestamp = (value: string): boolean => {
  if (value.length === 0) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime());
};

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const isSafePositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export const NonEmptyString = Schema.NonEmptyString;
export type NonEmptyString = typeof NonEmptyString.Type;

export const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
export type PositiveInteger = typeof PositiveInteger.Type;

export const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
export type NonNegativeNumber = typeof NonNegativeNumber.Type;

const AbsolutePathString = Schema.NonEmptyString.pipe(
  Schema.refine(
    (value): value is string => isAbsolutePath(value),
    { expected: "an absolute path" },
  ),
);

export const ResolvedPath = AbsolutePathString.pipe(Schema.brand("@xmux/server/ResolvedPath"));
export type ResolvedPath = typeof ResolvedPath.Type;

export const ConfigPath = ResolvedPath.pipe(Schema.brand("@xmux/server/ConfigPath"));
export type ConfigPath = typeof ConfigPath.Type;
export const StateDir = ResolvedPath.pipe(Schema.brand("@xmux/server/StateDir"));
export type StateDir = typeof StateDir.Type;
export const RuntimeDir = ResolvedPath.pipe(Schema.brand("@xmux/server/RuntimeDir"));
export type RuntimeDir = typeof RuntimeDir.Type;
export const LogDir = ResolvedPath.pipe(Schema.brand("@xmux/server/LogDir"));
export type LogDir = typeof LogDir.Type;
export const DatabasePath = ResolvedPath.pipe(Schema.brand("@xmux/server/DatabasePath"));
export type DatabasePath = typeof DatabasePath.Type;
export const ManifestPath = ResolvedPath.pipe(Schema.brand("@xmux/server/ManifestPath"));
export type ManifestPath = typeof ManifestPath.Type;
export const StartupLockPath = ResolvedPath.pipe(Schema.brand("@xmux/server/StartupLockPath"));
export type StartupLockPath = typeof StartupLockPath.Type;
export const UnixSocketPath = ResolvedPath.pipe(Schema.brand("@xmux/server/UnixSocketPath"));
export type UnixSocketPath = typeof UnixSocketPath.Type;

export const ScopeId = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/ScopeId"));
export type ScopeId = typeof ScopeId.Type;
export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/SessionId"));
export type SessionId = typeof SessionId.Type;

export const ProcessId = Schema.Number.pipe(
  Schema.refine(
    (value): value is number => isSafePositiveInteger(value),
    { expected: "a safe positive process id" },
  ),
  Schema.brand("@xmux/server/ProcessId"),
);
export type ProcessId = typeof ProcessId.Type;

export const IsoTimestamp = Schema.String.pipe(
  Schema.refine(
    (value): value is string => isValidIsoTimestamp(value),
    { expected: "an ISO timestamp" },
  ),
  Schema.brand("@xmux/server/IsoTimestamp"),
);
export type IsoTimestamp = typeof IsoTimestamp.Type;

export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(
  Schema.brand("@xmux/server/Port"),
);
export type Port = typeof Port.Type;
export const PortFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("@xmux/server/Port"),
);

export const BaseUrl = Schema.String.pipe(
  Schema.refine(
    (value): value is string => isValidUrl(value),
    { expected: "a URL" },
  ),
  Schema.brand("@xmux/server/BaseUrl"),
);
export type BaseUrl = typeof BaseUrl.Type;

export const EnvironmentVariableName = Schema.NonEmptyString.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u, { expected: "an environment variable name" }),
).pipe(Schema.brand("@xmux/server/EnvironmentVariableName"));
export type EnvironmentVariableName = typeof EnvironmentVariableName.Type;

export const SecretValue = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/SecretValue"));
export type SecretValue = typeof SecretValue.Type;
export const ModelId = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/ModelId"));
export type ModelId = typeof ModelId.Type;
export const ProviderId = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/ProviderId"));
export type ProviderId = typeof ProviderId.Type;
export const ModelVariant = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/ModelVariant"));
export type ModelVariant = typeof ModelVariant.Type;
export const DiscordApplicationId = Schema.NonEmptyString.pipe(
  Schema.brand("@xmux/server/DiscordApplicationId"),
);
export type DiscordApplicationId = typeof DiscordApplicationId.Type;
export const DiscordGuildId = Schema.NonEmptyString.pipe(Schema.brand("@xmux/server/DiscordGuildId"));
export type DiscordGuildId = typeof DiscordGuildId.Type;
export const DiscordPublicKey = Schema.NonEmptyString.pipe(
  Schema.brand("@xmux/server/DiscordPublicKey"),
);
export type DiscordPublicKey = typeof DiscordPublicKey.Type;
export const TelegramToken = SecretValue.pipe(Schema.brand("@xmux/server/TelegramToken"));
export type TelegramToken = typeof TelegramToken.Type;

export const LogLineCount = PositiveInteger.pipe(Schema.brand("@xmux/server/LogLineCount"));
export type LogLineCount = typeof LogLineCount.Type;
export const LogByteCount = PositiveInteger.pipe(Schema.brand("@xmux/server/LogByteCount"));
export type LogByteCount = typeof LogByteCount.Type;
export const LogRotationFileCount = PositiveInteger.pipe(
  Schema.brand("@xmux/server/LogRotationFileCount"),
);
export type LogRotationFileCount = typeof LogRotationFileCount.Type;

export const LogLineCountFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("@xmux/server/LogLineCount"),
);
export const LogByteCountFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("@xmux/server/LogByteCount"),
);
export const LogRotationFileCountFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("@xmux/server/LogRotationFileCount"),
);

export const parseResolvedPath = Schema.decodeUnknownEffect(ResolvedPath);
export const resolvedPathFromString = Schema.decodeSync(ResolvedPath);
export const configPathFromString = Schema.decodeSync(ConfigPath);
export const stateDirFromString = Schema.decodeSync(StateDir);
export const runtimeDirFromString = Schema.decodeSync(RuntimeDir);
export const logDirFromString = Schema.decodeSync(LogDir);
export const databasePathFromString = Schema.decodeSync(DatabasePath);
export const manifestPathFromString = Schema.decodeSync(ManifestPath);
export const startupLockPathFromString = Schema.decodeSync(StartupLockPath);
export const unixSocketPathFromString = Schema.decodeSync(UnixSocketPath);
export const scopeIdFromString = Schema.decodeSync(ScopeId);
export const sessionIdFromString = Schema.decodeSync(SessionId);
export const processIdFromNumber = Schema.decodeSync(ProcessId);
export const secretValueFromString = Schema.decodeSync(SecretValue);
export const isoTimestampFromString = Schema.decodeSync(IsoTimestamp);
export const logByteCountFromNumber = Schema.decodeSync(LogByteCount);
export const logRotationFileCountFromNumber = Schema.decodeSync(LogRotationFileCount);
