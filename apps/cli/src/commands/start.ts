import { Console, Effect, Option, References, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlClient, type ControlClientService } from "../control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../control/discovery";
import type {
  CliInvalidManifest,
  CliRunningServer,
  CliWrongScopeServer,
} from "../domain/discovery";
import { CliInvalidInput, CliLifecycleBlocked } from "../domain/errors";
import { parseServerTarget, type CliServerTarget } from "../domain/input";
import {
  alreadyRunningReport,
  inactiveLifecycleState,
  startedReport,
  type CliStartReport,
} from "../domain/lifecycle";
import { foregroundRetryCommand, renderStart } from "../output/lifecycle";
import { ProcessSpawner } from "../process/spawn";
import { waitForReachable, LifecycleTiming } from "../process/wait";
import { configPathFlag } from "./options";

interface StartInput {
  readonly configPath: Option.Option<string>;
}

const mapConfigPathError = (cause: Schema.SchemaError): CliInvalidInput =>
  new CliInvalidInput({
    message: "Invalid --config path.",
    field: "config",
    cause,
  });

const spawnedReadinessTimeoutMessage = (retryCommand: string): string =>
  `Timed out waiting for spawned xmux server readiness. Retry in the foreground: ${retryCommand}`;

const existingReadinessTimeoutMessage =
  "Timed out waiting for the active xmux server to become ready.";

const healthReady = (client: ControlClientService, server: CliRunningServer) =>
  client.health(server).pipe(
    Effect.catchTag("CliControlRequestError", () =>
      Effect.succeed({ alive: false, ready: false, state: "starting" as const }),
    ),
    Effect.map((health) => health.alive && health.ready),
  );

const waitForKnownServerReady = Effect.fn("cli.start.waitForKnownServerReady")(function* (input: {
  readonly server: CliRunningServer;
}) {
  const client = yield* ControlClient;
  const timing = yield* LifecycleTiming;
  yield* waitForReachable({
    check: healthReady(client, input.server),
    timeoutMs: timing.startTimeoutMs,
    intervalMs: timing.pollIntervalMs,
    socketPath: input.server.socketPath,
    operation: "start",
    timeoutMessage: existingReadinessTimeoutMessage,
  });
});

const discoverReady = (
  discovery: ControlDiscoveryService,
  client: ControlClientService,
  target: CliServerTarget,
) =>
  Effect.gen(function* () {
    const server = yield* discovery.discover(target);
    if (server._tag !== "Running") return false;
    return yield* healthReady(client, server);
  });

const waitForDiscoveredReadyServer = Effect.fn("cli.start.waitForDiscoveredReadyServer")(
  function* (input: {
    readonly target: CliServerTarget;
    readonly socketPath: string;
    readonly retryCommand: string;
  }) {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const timing = yield* LifecycleTiming;

    yield* waitForReachable({
      check: discoverReady(discovery, client, input.target),
      timeoutMs: timing.startTimeoutMs,
      intervalMs: timing.pollIntervalMs,
      socketPath: input.socketPath,
      operation: "start",
      timeoutMessage: spawnedReadinessTimeoutMessage(input.retryCommand),
    });

    return yield* discovery.requireRunning(input.target);
  },
);

const startBlockedError = (discovery: CliInvalidManifest | CliWrongScopeServer) => {
  const reason = discovery._tag === "InvalidManifest" ? "invalid-manifest" : "wrong-scope";
  const message =
    discovery._tag === "InvalidManifest"
      ? "Cannot start xmux server because the server manifest is invalid."
      : "Cannot start xmux server because the server manifest belongs to another scope.";

  return new CliLifecycleBlocked({
    message,
    operation: "start",
    reason,
    configPath: discovery.paths.configPath,
    manifestPath: discovery.paths.manifestPath,
    socketPath: discovery.paths.socketPath,
  });
};

export const getStartReport = Effect.fn("cli.start.report")(function* (input: StartInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );

  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const spawner = yield* ProcessSpawner;
    const retryCommand = foregroundRetryCommand(target.configPath);
    const initial = yield* discovery.discover(target);

    if (initial._tag === "Running") {
      yield* waitForKnownServerReady({ server: initial });
      return alreadyRunningReport(initial);
    }

    if (initial._tag === "InvalidManifest" || initial._tag === "WrongScope") {
      return yield* startBlockedError(initial);
    }

    const previous = inactiveLifecycleState(initial);
    const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
    yield* spawner.spawnDetached(spec);
    const server = yield* waitForDiscoveredReadyServer({
      target,
      socketPath: previous.paths.socketPath,
      retryCommand,
    });

    return startedReport(server, previous);
  });

  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runStartCommand = Effect.fn("cli.start")(function* (input: StartInput) {
  const report: CliStartReport = yield* getStartReport(input);
  yield* Console.log(renderStart(report));
});

export const startCommand = Command.make(
  "start",
  {
    configPath: configPathFlag,
  },
  runStartCommand,
).pipe(
  Command.withDescription("Start the xmux server and wait until it is ready."),
  Command.withShortDescription("Start the server."),
);
