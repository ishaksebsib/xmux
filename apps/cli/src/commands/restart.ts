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
  inactiveLifecycleState,
  restartedReport,
  restartStartedReport,
  type CliRestartReport,
} from "../domain/lifecycle";
import { foregroundRetryCommand, renderRestart } from "../output/lifecycle";
import { ProcessSpawner } from "../process/spawn";
import { LifecycleTiming, waitForReachable, waitForUnreachable } from "../process/wait";
import { configPathFlag } from "./options";

interface RestartInput {
  readonly configPath: Option.Option<string>;
}

const mapConfigPathError = (cause: Schema.SchemaError): CliInvalidInput =>
  new CliInvalidInput({
    message: "Invalid --config path.",
    field: "config",
    cause,
  });

const restartedReadinessTimeoutMessage = (retryCommand: string): string =>
  `Timed out waiting for restarted xmux server readiness. Retry in the foreground: ${retryCommand}`;

const healthReady = (client: ControlClientService, server: CliRunningServer) =>
  client.health(server).pipe(
    Effect.catchTag("CliControlRequestError", () =>
      Effect.succeed({ alive: false, ready: false, state: "starting" as const }),
    ),
    Effect.map((health) => health.alive && health.ready),
  );

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

const waitForStoppedServer = Effect.fn("cli.restart.waitForStoppedServer")(function* (input: {
  readonly server: CliRunningServer;
}) {
  const client = yield* ControlClient;
  const timing = yield* LifecycleTiming;

  yield* waitForUnreachable({
    check: client.health(input.server).pipe(
      Effect.map((health) => health.alive),
      Effect.catchTag("CliControlRequestError", () => Effect.succeed(true)),
    ),
    timeoutMs: timing.stopTimeoutMs,
    intervalMs: timing.pollIntervalMs,
    socketPath: input.server.socketPath,
    operation: "restart",
  });
});

const waitForRestartedReadyServer = Effect.fn("cli.restart.waitForRestartedReadyServer")(
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
      operation: "restart",
      timeoutMessage: restartedReadinessTimeoutMessage(input.retryCommand),
    });

    return yield* discovery.requireRunning(input.target);
  },
);

const restartBlockedError = (discovery: CliInvalidManifest | CliWrongScopeServer) => {
  const reason = discovery._tag === "InvalidManifest" ? "invalid-manifest" : "wrong-scope";
  const message =
    discovery._tag === "InvalidManifest"
      ? "Cannot restart xmux server because the server manifest is invalid."
      : "Cannot restart xmux server because the server manifest belongs to another scope.";

  return new CliLifecycleBlocked({
    message,
    operation: "restart",
    reason,
    configPath: discovery.paths.configPath,
    manifestPath: discovery.paths.manifestPath,
    socketPath: discovery.paths.socketPath,
  });
};

export const getRestartReport = Effect.fn("cli.restart.report")(function* (input: RestartInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );

  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const spawner = yield* ProcessSpawner;
    const retryCommand = foregroundRetryCommand(target.configPath);
    const initial = yield* discovery.discover(target);

    if (initial._tag === "InvalidManifest" || initial._tag === "WrongScope") {
      return yield* restartBlockedError(initial);
    }

    if (initial._tag === "Running") {
      const shutdown = yield* client.shutdown(initial);
      yield* waitForStoppedServer({ server: initial });
      const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
      yield* spawner.spawnDetached(spec);
      const server = yield* waitForRestartedReadyServer({
        target,
        socketPath: initial.socketPath,
        retryCommand,
      });
      return restartedReport(initial, server, shutdown);
    }

    const previous = inactiveLifecycleState(initial);
    const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
    yield* spawner.spawnDetached(spec);
    const server = yield* waitForRestartedReadyServer({
      target,
      socketPath: previous.paths.socketPath,
      retryCommand,
    });

    return restartStartedReport(server, previous);
  });

  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runRestartCommand = Effect.fn("cli.restart")(function* (input: RestartInput) {
  const report: CliRestartReport = yield* getRestartReport(input);
  yield* Console.log(renderRestart(report));
});

export const restartCommand = Command.make(
  "restart",
  {
    configPath: configPathFlag,
  },
  runRestartCommand,
).pipe(
  Command.withDescription("Restart the xmux server."),
  Command.withShortDescription("Restart the server."),
);
