import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlClient } from "../control/client";
import { ControlDiscovery } from "../control/discovery";
import type { CliRunningServer } from "../domain/discovery";
import { parseServerTarget } from "../domain/input";
import {
  inactiveLifecycleState,
  lifecycleBlockedError,
  restartedReport,
  restartStartedReport,
  type CliRestartReport,
} from "../domain/lifecycle";
import { foregroundRetryCommand, renderRestart } from "../output/lifecycle";
import { waitForSpawnedReadyServer } from "../process/readiness";
import { ProcessSpawner } from "../process/spawn";
import { StartLock } from "../process/start-lock";
import { LifecycleTiming, waitForUnreachable } from "../process/wait";
import { mapConfigPathError } from "./input";
import { configPathFlag } from "./options";

interface RestartInput {
  readonly configPath: Option.Option<string>;
}

const restartedReadinessTimeoutMessage = (retryCommand: string): string =>
  `Timed out waiting for restarted xmux server readiness. Retry in the foreground: ${retryCommand}`;

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
      return yield* lifecycleBlockedError({ operation: "restart", discovery: initial });
    }

    const startLock = yield* StartLock;

    return yield* startLock.withLock(
      initial.paths,
      Effect.gen(function* () {
        const lockedDiscovery = yield* discovery.discover(target);

        if (lockedDiscovery._tag === "InvalidManifest" || lockedDiscovery._tag === "WrongScope") {
          return yield* lifecycleBlockedError({ operation: "restart", discovery: lockedDiscovery });
        }

        if (lockedDiscovery._tag === "Running") {
          const shutdown = yield* client.shutdown(lockedDiscovery);
          yield* waitForStoppedServer({ server: lockedDiscovery });
          const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
          const spawned = yield* spawner.spawnDetached(spec);
          const server = yield* waitForSpawnedReadyServer({
            target,
            socketPath: lockedDiscovery.socketPath,
            logDir: lockedDiscovery.paths.logDir,
            operation: "restart",
            timeoutMessage: restartedReadinessTimeoutMessage(retryCommand),
            retryCommand,
            spawned,
          });
          return restartedReport(lockedDiscovery, server, shutdown);
        }

        const previous = inactiveLifecycleState(lockedDiscovery);
        const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
        const spawned = yield* spawner.spawnDetached(spec);
        const server = yield* waitForSpawnedReadyServer({
          target,
          socketPath: previous.paths.socketPath,
          logDir: previous.paths.logDir,
          operation: "restart",
          timeoutMessage: restartedReadinessTimeoutMessage(retryCommand),
          retryCommand,
          spawned,
        });

        return restartStartedReport(server, previous);
      }),
    );
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
