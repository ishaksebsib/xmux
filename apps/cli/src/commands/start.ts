import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlDiscovery } from "../control/discovery";
import { runningOrchestratorStatus } from "../control/orchestrator-status";
import { parseServerTarget } from "../domain/input";
import {
  alreadyRunningReport,
  inactiveLifecycleState,
  lifecycleBlockedError,
  startedReport,
  type CliStartReport,
} from "../domain/lifecycle";
import { foregroundRetryCommand, renderStart } from "../output/lifecycle";
import { waitForKnownReadyServer, waitForSpawnedReadyServer } from "../process/readiness";
import { ProcessSpawner } from "../process/spawn";
import { StartLock } from "../process/start-lock";
import { mapConfigPathError } from "./input";
import { configPathFlag } from "./options";

interface StartInput {
  readonly configPath: Option.Option<string>;
}

const spawnedReadinessTimeoutMessage = (retryCommand: string): string =>
  `Timed out waiting for spawned xmux server readiness. Retry in the foreground: ${retryCommand}`;

const existingReadinessTimeoutMessage =
  "Timed out waiting for the active xmux server to become ready.";

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
      yield* waitForKnownReadyServer({
        server: initial,
        operation: "start",
        timeoutMessage: existingReadinessTimeoutMessage,
      });
      const orchestrator = yield* runningOrchestratorStatus(initial);
      return alreadyRunningReport(initial, orchestrator);
    }

    if (initial._tag === "InvalidManifest" || initial._tag === "WrongScope") {
      return yield* lifecycleBlockedError({ operation: "start", discovery: initial });
    }

    const startLock = yield* StartLock;
    const previous = inactiveLifecycleState(initial);

    return yield* startLock.withLock(
      previous.paths,
      Effect.gen(function* () {
        const lockedDiscovery = yield* discovery.discover(target);

        if (lockedDiscovery._tag === "Running") {
          yield* waitForKnownReadyServer({
            server: lockedDiscovery,
            operation: "start",
            timeoutMessage: existingReadinessTimeoutMessage,
          });
          const orchestrator = yield* runningOrchestratorStatus(lockedDiscovery);
          return alreadyRunningReport(lockedDiscovery, orchestrator);
        }

        if (lockedDiscovery._tag === "InvalidManifest" || lockedDiscovery._tag === "WrongScope") {
          return yield* lifecycleBlockedError({ operation: "start", discovery: lockedDiscovery });
        }

        const lockedPrevious = inactiveLifecycleState(lockedDiscovery);
        const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
        const spawned = yield* spawner.spawnDetached(spec);
        const server = yield* waitForSpawnedReadyServer({
          target,
          socketPath: lockedPrevious.paths.socketPath,
          logDir: lockedPrevious.paths.logDir,
          operation: "start",
          timeoutMessage: spawnedReadinessTimeoutMessage(retryCommand),
          retryCommand,
          spawned,
        });

        const orchestrator = yield* runningOrchestratorStatus(server);
        return startedReport(server, orchestrator, lockedPrevious);
      }),
    );
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
