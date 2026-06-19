import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { Effect, FileSystem, Path } from "effect";
import { RuntimePathError } from "../errors";
import type { NormalizedServerOptions, ServerControlEndpoint } from "../options";

/** Resolved paths are explicit so the CLI and server agree on one local scope. */
export interface ServerRuntimePaths {
  readonly configPath: string;
  readonly stateDir: string;
  readonly runtimeDir: string;
  readonly logDir: string;
  readonly dbPath: string;
  readonly manifestPath: string;
  readonly startupLockPath: string;
  readonly controlEndpoint: ServerControlEndpoint;
  readonly scopeId: string;
}

const APP_DIR_NAME = "xmux";
const DEFAULT_CONFIG_FILE_NAME = "config.jsonc";
const DEFAULT_DB_FILE_NAME = "xmux.db";

const expandHome = (pathService: Path.Path, home: string, input: string): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return pathService.join(home, input.slice(2));
  return input;
};

const resolveInputPath = (pathService: Path.Path, home: string, input: string): string =>
  pathService.resolve(expandHome(pathService, home, input));

const optionalOverride = (
  pathService: Path.Path,
  home: string,
  input: string | undefined,
): string | undefined => (input === undefined ? undefined : resolveInputPath(pathService, home, input));

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
): {
  readonly configPath: string;
  readonly stateDir: string;
  readonly logDir: string;
} => {
  if (process.platform === "darwin") {
    const appSupportDir = pathService.join(home, "Library", "Application Support", APP_DIR_NAME);
    return {
      configPath: pathService.join(appSupportDir, DEFAULT_CONFIG_FILE_NAME),
      stateDir: appSupportDir,
      logDir: pathService.join(home, "Library", "Logs", APP_DIR_NAME),
    };
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? pathService.join(home, ".config");
  const stateHome = process.env.XDG_STATE_HOME ?? pathService.join(home, ".local", "state");

  return {
    configPath: pathService.join(configHome, APP_DIR_NAME, DEFAULT_CONFIG_FILE_NAME),
    stateDir: pathService.join(stateHome, APP_DIR_NAME),
    logDir: pathService.join(stateHome, APP_DIR_NAME, "logs"),
  };
};

/** Resolve runtime paths once so later services do not guess filesystem layout. */
export const resolveRuntimePaths = Effect.fn("server.resolveRuntimePaths")(function* (
  options: NormalizedServerOptions,
) {
  const pathService = yield* Path.Path;
  const home = homedir();
  const defaults = defaultLayout(pathService, home);
  const overrides = options.pathOverrides;

  if (process.platform === "win32" && options.controlEndpointOverride === undefined) {
    return yield* RuntimePathError.make({
      message: "Windows control endpoints are not implemented yet.",
    });
  }

  const configPath = resolveInputPath(
    pathService,
    home,
    options.configPath ?? defaults.configPath,
  );
  const stateDir =
    optionalOverride(pathService, home, overrides?.stateDir) ?? pathService.resolve(defaults.stateDir);
  const logDir =
    optionalOverride(pathService, home, overrides?.logDir) ?? pathService.resolve(defaults.logDir);
  const runtimeDir =
    optionalOverride(pathService, home, overrides?.runtimeDir) ??
    pathService.resolve(
      process.env.XDG_RUNTIME_DIR === undefined
        ? pathService.join(stateDir, "run")
        : pathService.join(process.env.XDG_RUNTIME_DIR, APP_DIR_NAME),
    );
  const dbPath =
    optionalOverride(pathService, home, overrides?.dbPath) ??
    pathService.join(stateDir, DEFAULT_DB_FILE_NAME);
  const scopeId = createScopeId({ configPath, stateDir });
  const manifestPath =
    optionalOverride(pathService, home, overrides?.manifestPath) ??
    pathService.join(stateDir, "server-control", `server-${scopeId}.json`);
  const startupLockPath =
    optionalOverride(pathService, home, overrides?.startupLockPath) ??
    pathService.join(stateDir, "server-control", `startup-${scopeId}.lock`);
  const defaultControlEndpoint: ServerControlEndpoint = {
    kind: "unix-socket",
    path: pathService.join(runtimeDir, `server-${scopeId}.sock`),
  };
  const controlEndpoint = options.controlEndpointOverride ?? defaultControlEndpoint;

  return {
    configPath,
    stateDir,
    runtimeDir,
    logDir,
    dbPath,
    manifestPath,
    startupLockPath,
    controlEndpoint,
    scopeId,
  };
});

const makeDirectory = (directory: string): Effect.Effect<void, RuntimePathError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
      Effect.mapError(
        (cause) =>
          RuntimePathError.make({
            message: `Failed to create runtime directory: ${directory}`,
            path: directory,
            cause,
          }),
      ),
    );
    if (process.platform === "win32") return;
    yield* fs.chmod(directory, 0o700).pipe(
      Effect.mapError(
        (cause) =>
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
