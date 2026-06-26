import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  APP_DIR_NAME,
  DEFAULT_CONFIG_FILE_NAME,
  DEFAULT_DB_FILE_NAME,
  LOG_DIR_NAME,
  RUNTIME_DIR_NAME,
  SERVER_CONTROL_DIR_NAME,
  SERVER_MANIFEST_FILE_PREFIX,
  SERVER_SOCKET_FILE_PREFIX,
  STARTUP_LOCK_FILE_EXTENSION,
  STARTUP_LOCK_FILE_PREFIX,
  UNIX_SOCKET_FILE_EXTENSION,
} from "./constants";
import { ServerBootConfig, type ServerBootConfigService } from "../config/boot";
import { ServerControlEndpoint } from "../contracts/control";
import {
  ConfigPath,
  DatabasePath,
  LogDir,
  ManifestPath,
  RuntimeDir,
  ScopeId,
  scopeIdFromString,
  resolvedPathFromString,
  StartupLockPath,
  StateDir,
  UnixSocketPath,
} from "../contracts/primitives";
import { RuntimePathError } from "../errors";
import { ServerOptions, type ParsedServerOptions } from "../options";
import { HostRuntime } from "../platform/host";
import { expandHome } from "../platform/path";

export { resolvedPathFromString };

const decodeConfigPath = Schema.decodeUnknownEffect(ConfigPath);
const decodeStateDir = Schema.decodeUnknownEffect(StateDir);
const decodeRuntimeDir = Schema.decodeUnknownEffect(RuntimeDir);
const decodeLogDir = Schema.decodeUnknownEffect(LogDir);
const decodeDatabasePath = Schema.decodeUnknownEffect(DatabasePath);
const decodeManifestPath = Schema.decodeUnknownEffect(ManifestPath);
const decodeStartupLockPath = Schema.decodeUnknownEffect(StartupLockPath);
const decodeUnixSocketPath = Schema.decodeUnknownEffect(UnixSocketPath);

/** Resolved paths are explicit so the CLI and server agree on one local scope. */
export interface ServerRuntimePaths {
  readonly configPath: ConfigPath;
  readonly stateDir: StateDir;
  readonly runtimeDir: RuntimeDir;
  readonly logDir: LogDir;
  readonly dbPath: DatabasePath;
  readonly manifestPath: ManifestPath;
  readonly startupLockPath: StartupLockPath;
  readonly controlEndpoint: ServerControlEndpoint;
  readonly scopeId: ScopeId;
}

const parseWith = <A>(
  decode: (u: unknown) => Effect.Effect<A, Schema.SchemaError>,
  input: {
    readonly path: string;
    readonly message: string;
  },
): Effect.Effect<A, RuntimePathError> =>
  decode(input.path).pipe(
    Effect.mapError((cause) =>
      RuntimePathError.make({
        message: input.message,
        path: input.path,
        cause,
      }),
    ),
  );

const resolveInputConfigPath = (
  pathService: Path.Path,
  home: string,
  input: string,
): Effect.Effect<ConfigPath, RuntimePathError> => {
  const path = pathService.resolve(expandHome(pathService, home, input));
  return parseWith(decodeConfigPath, { path, message: `Resolved config path is invalid: ${path}` });
};

const fnv1a32 = (value: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
};

const hex32 = (value: number): string => value.toString(16).padStart(8, "0");

/** Scope IDs are stable, short, and path-safe; they are not security identifiers. */
export const createScopeId = (input: {
  readonly configPath: string;
  readonly stateDir: string;
}): ScopeId => {
  const value = `${input.configPath}\0${input.stateDir}`;
  return scopeIdFromString(
    `${hex32(fnv1a32(value, 0x811c9dc5))}${hex32(fnv1a32(value, 0x01000193))}`,
  );
};

const defaultLayout = (
  pathService: Path.Path,
  home: string,
  platform: string,
  boot: ServerBootConfigService,
): {
  readonly configPath: string;
  readonly stateDir: string;
  readonly logDir: string;
} => {
  if (platform === "darwin") {
    const appSupportDir = pathService.join(home, "Library", "Application Support", APP_DIR_NAME);
    return {
      configPath: pathService.join(appSupportDir, DEFAULT_CONFIG_FILE_NAME),
      stateDir: appSupportDir,
      logDir: pathService.join(home, "Library", "Logs", APP_DIR_NAME),
    };
  }

  const configHome = boot.xdgConfigHome.pipe(
    Option.getOrElse(() => pathService.join(home, ".config")),
  );
  const stateHome = boot.xdgStateHome.pipe(
    Option.getOrElse(() => pathService.join(home, ".local", "state")),
  );

  return {
    configPath: pathService.join(configHome, APP_DIR_NAME, DEFAULT_CONFIG_FILE_NAME),
    stateDir: pathService.join(stateHome, APP_DIR_NAME),
    logDir: pathService.join(stateHome, APP_DIR_NAME, LOG_DIR_NAME),
  };
};

/** Resolve runtime paths once so later services do not guess filesystem layout. */
export const resolveRuntimePaths = Effect.fn("server.resolveRuntimePaths")(function* (
  options: ParsedServerOptions,
) {
  const pathService = yield* Path.Path;
  const host = yield* HostRuntime;
  const home = host.homeDir;
  const boot = yield* ServerBootConfig;
  const defaults = defaultLayout(pathService, home, host.platform, boot);

  if (host.platform === "win32") {
    return yield* RuntimePathError.make({
      message: "Windows control endpoints are not implemented yet.",
    });
  }

  const configPath = yield* resolveInputConfigPath(
    pathService,
    home,
    options.configPath ?? defaults.configPath,
  );
  const stateDir = yield* parseWith(decodeStateDir, {
    path: pathService.resolve(defaults.stateDir),
    message: `Resolved state directory is invalid: ${defaults.stateDir}`,
  });
  const logDir = yield* parseWith(decodeLogDir, {
    path: pathService.resolve(defaults.logDir),
    message: `Resolved log directory is invalid: ${defaults.logDir}`,
  });
  const runtimeHome = Option.getOrUndefined(boot.xdgRuntimeDir);
  const runtimeDirInput = pathService.resolve(
    runtimeHome === undefined
      ? pathService.join(stateDir, RUNTIME_DIR_NAME)
      : pathService.join(runtimeHome, APP_DIR_NAME),
  );
  const runtimeDir = yield* parseWith(decodeRuntimeDir, {
    path: runtimeDirInput,
    message: `Resolved runtime directory is invalid: ${runtimeDirInput}`,
  });
  const dbPathInput = pathService.join(stateDir, DEFAULT_DB_FILE_NAME);
  const dbPath = yield* parseWith(decodeDatabasePath, {
    path: dbPathInput,
    message: `Resolved database path is invalid: ${dbPathInput}`,
  });
  const scopeId = createScopeId({ configPath, stateDir });
  const controlDir = pathService.join(stateDir, SERVER_CONTROL_DIR_NAME);
  const manifestPathInput = pathService.join(
    controlDir,
    `${SERVER_MANIFEST_FILE_PREFIX}-${scopeId}.json`,
  );
  const manifestPath = yield* parseWith(decodeManifestPath, {
    path: manifestPathInput,
    message: `Resolved manifest path is invalid: ${manifestPathInput}`,
  });
  const startupLockPathInput = pathService.join(
    controlDir,
    `${STARTUP_LOCK_FILE_PREFIX}-${scopeId}.${STARTUP_LOCK_FILE_EXTENSION}`,
  );
  const startupLockPath = yield* parseWith(decodeStartupLockPath, {
    path: startupLockPathInput,
    message: `Resolved startup lock path is invalid: ${startupLockPathInput}`,
  });
  const endpointPathInput = pathService.join(
    runtimeDir,
    `${SERVER_SOCKET_FILE_PREFIX}-${scopeId}.${UNIX_SOCKET_FILE_EXTENSION}`,
  );
  const endpointPath = yield* parseWith(decodeUnixSocketPath, {
    path: endpointPathInput,
    message: `Resolved control endpoint path is invalid: ${endpointPathInput}`,
  });
  const defaultControlEndpoint = ServerControlEndpoint.make({
    kind: "unix-socket",
    path: endpointPath,
  });

  return {
    configPath,
    stateDir,
    runtimeDir,
    logDir,
    dbPath,
    manifestPath,
    startupLockPath,
    controlEndpoint: defaultControlEndpoint,
    scopeId,
  };
});

/** RuntimePaths exposes the once-resolved filesystem/control layout as a service. */
export class RuntimePaths extends Context.Service<RuntimePaths, ServerRuntimePaths>()(
  "@xmux/server/RuntimePaths",
) {
  /** Resolve paths from normalized server options at the application boundary. */
  static readonly layer = Layer.effect(
    RuntimePaths,
    Effect.gen(function* () {
      const options = yield* ServerOptions;
      return yield* resolveRuntimePaths(options);
    }),
  );
}

const makeDirectory = (
  directory: string,
): Effect.Effect<void, RuntimePathError, FileSystem.FileSystem | HostRuntime> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
      Effect.mapError((cause) =>
        RuntimePathError.make({
          message: `Failed to create runtime directory: ${directory}`,
          path: directory,
          cause,
        }),
      ),
    );
    const host = yield* HostRuntime;
    if (host.platform === "win32") return;
    yield* fs.chmod(directory, 0o700).pipe(
      Effect.mapError((cause) =>
        RuntimePathError.make({
          message: `Failed to secure runtime directory: ${directory}`,
          path: directory,
          cause,
        }),
      ),
    );
  });

/** Create owner-only directories before files or sockets are published. */
export const ensureRuntimeDirectories = Effect.fn("server.ensureRuntimeDirectories")(function* (
  paths: ServerRuntimePaths,
) {
  const pathService = yield* Path.Path;
  const directories = new Set<string>();
  directories.add(paths.stateDir);
  directories.add(paths.runtimeDir);
  directories.add(paths.logDir);
  directories.add(pathService.dirname(paths.dbPath));
  directories.add(pathService.dirname(paths.manifestPath));
  directories.add(pathService.dirname(paths.startupLockPath));
  directories.add(pathService.dirname(paths.controlEndpoint.path));

  for (const directory of directories) {
    yield* makeDirectory(directory);
  }
});
