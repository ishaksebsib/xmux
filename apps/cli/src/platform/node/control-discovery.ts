import {
  findXmuxServer,
  readXmuxServerManifest,
  resolveXmuxServerPaths,
  type XmuxServerPaths,
} from "@xmux/server/platform/node";
import { Effect, Layer } from "effect";
import { ControlDiscovery, type ControlDiscoveryService } from "../../control/discovery";
import {
  CliInvalidManifest,
  CliNoManifest,
  CliResolvedServerPaths,
  CliRunningServer,
  CliServerManifest,
  CliStaleManifestCleanedServer,
  CliStoppedServer,
  CliValidManifest,
  CliWrongScopeServer,
  inactiveServerStateFromDiscovery,
} from "../../domain/discovery";
import { CliDiscoveryError, CliServerNotRunning, safeErrorReason } from "../../domain/errors";
import {
  isLocalControlSupportedPlatform,
  unsupportedLocalControlPlatformError,
} from "../../process/platform-support";
import type { CliServerTarget } from "../../domain/input";

interface CliRunOptions {
  readonly configPath?: string;
}

type ServerManifestDiscovery = Effect.Success<ReturnType<typeof readXmuxServerManifest>>;
type ServerManifest = Extract<
  ServerManifestDiscovery,
  { readonly _tag: "ValidManifest" }
>["manifest"];

const toRunOptions = (target: CliServerTarget): CliRunOptions =>
  target.configPath === undefined ? {} : { configPath: target.configPath };

const mapDiscoveryError =
  (message: string) =>
  (cause: unknown): CliDiscoveryError =>
    new CliDiscoveryError({ message, reason: safeErrorReason(cause), cause });

export const toCliPaths = (paths: XmuxServerPaths): CliResolvedServerPaths =>
  new CliResolvedServerPaths({
    configPath: paths.configPath,
    stateDir: paths.stateDir,
    runtimeDir: paths.runtimeDir,
    logDir: paths.logDir,
    dbPath: paths.dbPath,
    manifestPath: paths.manifestPath,
    startupLockPath: paths.startupLockPath,
    socketPath: paths.controlEndpoint.path,
    scopeId: paths.scopeId,
  });

const toCliManifest = (manifest: ServerManifest): CliServerManifest =>
  new CliServerManifest({
    version: manifest.version,
    protocolVersion: manifest.protocolVersion,
    pid: manifest.pid,
    sessionId: manifest.sessionId,
    startedAt: manifest.startedAt,
    configPath: manifest.configPath,
    stateDir: manifest.stateDir,
    scopeId: manifest.scopeId,
    endpointPath: manifest.endpoint.path,
    ownerClient: manifest.owner.client,
    ownerVersion: manifest.owner.version,
    ownerExecutablePath: manifest.owner.executablePath,
  });

const failIfLocalControlUnsupported = Effect.sync(() => process.platform).pipe(
  Effect.flatMap((platform) =>
    isLocalControlSupportedPlatform(platform)
      ? Effect.void
      : Effect.fail(unsupportedLocalControlPlatformError(platform)),
  ),
);

const makeControlDiscovery = (): ControlDiscoveryService => {
  const resolvePaths = Effect.fn("cli.discovery.resolvePaths")(function* (target: CliServerTarget) {
    yield* failIfLocalControlUnsupported;
    const paths = yield* resolveXmuxServerPaths(toRunOptions(target)).pipe(
      Effect.mapError(mapDiscoveryError("Failed to resolve xmux server paths.")),
    );
    return toCliPaths(paths);
  });

  const readManifest = Effect.fn("cli.discovery.readManifest")(function* (target: CliServerTarget) {
    yield* failIfLocalControlUnsupported;
    const discovery = yield* readXmuxServerManifest(toRunOptions(target)).pipe(
      Effect.mapError(mapDiscoveryError("Failed to read xmux server manifest.")),
    );
    const paths = toCliPaths(discovery.paths);

    switch (discovery._tag) {
      case "NoManifest":
        return new CliNoManifest({ _tag: "NoManifest", paths });
      case "InvalidManifest":
        return new CliInvalidManifest({
          _tag: "InvalidManifest",
          paths,
          reason: discovery.reason,
        });
      case "ValidManifest":
        return new CliValidManifest({
          _tag: "ValidManifest",
          paths,
          manifest: toCliManifest(discovery.manifest),
        });
    }
  });

  const discover = Effect.fn("cli.discovery.discover")(function* (target: CliServerTarget) {
    yield* failIfLocalControlUnsupported;
    const discovery = yield* findXmuxServer(toRunOptions(target)).pipe(
      Effect.mapError(mapDiscoveryError("Failed to discover xmux server.")),
    );
    const paths = toCliPaths(discovery.paths);

    if (discovery._tag === "Running") {
      return new CliRunningServer({
        _tag: "Running",
        paths,
        manifestPath: discovery.active.manifestPath,
        socketPath: discovery.active.endpointPath,
        pid: discovery.active.pid,
        pidAlive: discovery.active.pidAlive,
        sessionId: discovery.active.sessionId,
      });
    }

    switch (discovery.reason) {
      case "no-manifest":
        return new CliStoppedServer({ _tag: "Stopped", paths });
      case "invalid-manifest":
        return new CliInvalidManifest({ _tag: "InvalidManifest", paths });
      case "wrong-scope":
        return new CliWrongScopeServer({ _tag: "WrongScope", paths });
      case "stale-manifest-removed":
        return new CliStaleManifestCleanedServer({ _tag: "StaleManifestCleaned", paths });
    }
  });

  const requireRunning = Effect.fn("cli.discovery.requireRunning")(function* (
    target: CliServerTarget,
  ) {
    const discovery = yield* discover(target);
    if (discovery._tag === "Running") return discovery;

    const inactive = inactiveServerStateFromDiscovery(discovery);
    return yield* new CliServerNotRunning({
      message: "xmux server is not running.",
      reason: inactive.reason,
      manifestPath: inactive.paths.manifestPath,
      socketPath: inactive.paths.socketPath,
    });
  });

  return { resolvePaths, readManifest, discover, requireRunning };
};

export const nodeControlDiscoveryLayer = Layer.succeed(ControlDiscovery, makeControlDiscovery());
