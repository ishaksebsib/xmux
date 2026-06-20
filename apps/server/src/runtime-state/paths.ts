import { createHash } from "node:crypto";
import { Effect, FileSystem, Path } from "effect";
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
  XDG_CONFIG_HOME_ENV,
  XDG_RUNTIME_DIR_ENV,
  XDG_STATE_HOME_ENV,
} from "../contracts/constants";
import { RuntimePathError } from "../errors";
import type { NormalizedServerOptions } from "../options";
import { HostRuntime } from "../runtime/host";

declare const resolvedPathBrand: unique symbol;

/** Absolute path resolved once at the server runtime boundary. */
export type ResolvedPath = string & { readonly [resolvedPathBrand]?: true };

/** Local control endpoint. Windows named pipes should be added only with real transport support. */
export interface ServerControlEndpoint {
  readonly kind: "unix-socket";
  readonly path: ResolvedPath;
}

/** Resolved paths are explicit so the CLI and server agree on one local scope. */
export interface ServerRuntimePaths {
  readonly configPath: ResolvedPath;
  readonly stateDir: ResolvedPath;
  readonly runtimeDir: ResolvedPath;
  readonly logDir: ResolvedPath;
  readonly dbPath: ResolvedPath;
  readonly manifestPath: ResolvedPath;
  readonly startupLockPath: ResolvedPath;
  readonly controlEndpoint: ServerControlEndpoint;
  readonly scopeId: string;
}

const expandHome = (pathService: Path.Path, home: string, input: string): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return pathService.join(home, input.slice(2));
  return input;
};

const asResolvedPath = (path: string): ResolvedPath => path as ResolvedPath;

const resolveInputPath = (pathService: Path.Path, home: string, input: string): ResolvedPath =>
  asResolvedPath(pathService.resolve(expandHome(pathService, home, input)));

/** Scope IDs are hashed to keep socket and manifest names short and path-safe. */
export const createScopeId = (input: {
  readonly configPath: string;
  readonly stateDir: string;
}): string =>
  createHash("sha256")
    .update(input.configPath)
    .update("\0")
    .update(input.stateDir)
    .digest("hex")
    .slice(0, 16);

const defaultLayout = (
  pathService: Path.Path,
  home: string,
  platform: string,
  getEnv: (name: string) => string | undefined,
): {
  readonly configPath: ResolvedPath;
  readonly stateDir: ResolvedPath;
  readonly logDir: ResolvedPath;
} => {
  if (platform === "darwin") {
    const appSupportDir = pathService.join(home, "Library", "Application Support", APP_DIR_NAME);
    return {
      configPath: asResolvedPath(pathService.join(appSupportDir, DEFAULT_CONFIG_FILE_NAME)),
      stateDir: asResolvedPath(appSupportDir),
      logDir: asResolvedPath(pathService.join(home, "Library", "Logs", APP_DIR_NAME)),
    };
  }

  const configHome = getEnv(XDG_CONFIG_HOME_ENV) ?? pathService.join(home, ".config");
  const stateHome = getEnv(XDG_STATE_HOME_ENV) ?? pathService.join(home, ".local", "state");

  return {
    configPath: asResolvedPath(
      pathService.join(configHome, APP_DIR_NAME, DEFAULT_CONFIG_FILE_NAME),
    ),
    stateDir: asResolvedPath(pathService.join(stateHome, APP_DIR_NAME)),
    logDir: asResolvedPath(pathService.join(stateHome, APP_DIR_NAME, LOG_DIR_NAME)),
  };
};

/** Resolve runtime paths once so later services do not guess filesystem layout. */
export const resolveRuntimePaths = Effect.fn("server.resolveRuntimePaths")(function* (
  options: NormalizedServerOptions,
) {
  const pathService = yield* Path.Path;
  const host = yield* HostRuntime;
  const home = host.homeDir;
  const defaults = defaultLayout(pathService, home, host.platform, host.getEnv);

  if (host.platform === "win32") {
    return yield* RuntimePathError.make({
      message: "Windows control endpoints are not implemented yet.",
    });
  }

  const configPath = resolveInputPath(pathService, home, options.configPath ?? defaults.configPath);
  const stateDir = asResolvedPath(pathService.resolve(defaults.stateDir));
  const logDir = asResolvedPath(pathService.resolve(defaults.logDir));
  const runtimeDir = asResolvedPath(
    pathService.resolve(
      host.getEnv(XDG_RUNTIME_DIR_ENV) === undefined
        ? pathService.join(stateDir, RUNTIME_DIR_NAME)
        : pathService.join(host.getEnv(XDG_RUNTIME_DIR_ENV) ?? stateDir, APP_DIR_NAME),
    ),
  );
  const dbPath = asResolvedPath(pathService.join(stateDir, DEFAULT_DB_FILE_NAME));
  const scopeId = createScopeId({ configPath, stateDir });
  const controlDir = pathService.join(stateDir, SERVER_CONTROL_DIR_NAME);
  const manifestPath = asResolvedPath(
    pathService.join(controlDir, `${SERVER_MANIFEST_FILE_PREFIX}-${scopeId}.json`),
  );
  const startupLockPath = asResolvedPath(
    pathService.join(
      controlDir,
      `${STARTUP_LOCK_FILE_PREFIX}-${scopeId}.${STARTUP_LOCK_FILE_EXTENSION}`,
    ),
  );
  const defaultControlEndpoint: ServerControlEndpoint = {
    kind: "unix-socket",
    path: asResolvedPath(
      pathService.join(
        runtimeDir,
        `${SERVER_SOCKET_FILE_PREFIX}-${scopeId}.${UNIX_SOCKET_FILE_EXTENSION}`,
      ),
    ),
  };

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
