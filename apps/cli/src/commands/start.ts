import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlDiscovery } from "../control/discovery";
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
      return alreadyRunningReport(initial);
    }

    if (initial._tag === "InvalidManifest" || initial._tag === "WrongScope") {
      return yield* lifecycleBlockedError({ operation: "start", discovery: initial });
    }

    const previous = inactiveLifecycleState(initial);
    const spec = yield* spawner.buildServerRunSpawnSpec({ configPath: target.configPath });
    const spawned = yield* spawner.spawnDetached(spec);
    const server = yield* waitForSpawnedReadyServer({
      target,
      socketPath: previous.paths.socketPath,
      logDir: previous.paths.logDir,
      operation: "start",
      timeoutMessage: spawnedReadinessTimeoutMessage(retryCommand),
      retryCommand,
      spawned,
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
