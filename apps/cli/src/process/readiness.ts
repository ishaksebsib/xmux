import { Effect } from "effect";
import {
  ControlClient,
  type CliHealthResponse,
  type ControlClientService,
} from "../control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../control/discovery";
import type { CliRunningServer } from "../domain/discovery";
import { CliSpawnedServerExited, type CliWaitOperation } from "../domain/errors";
import type { CliServerTarget } from "../domain/input";
import type { CliSpawnedProcess } from "./spawn";
import { LifecycleTiming, waitForReachable } from "./wait";

const startingHealth: CliHealthResponse = { alive: false, ready: false, state: "starting" };

export const serverHealthReady = (client: ControlClientService, server: CliRunningServer) =>
  client.health(server).pipe(
    Effect.catchTag("CliControlRequestError", () => Effect.succeed(startingHealth)),
    Effect.map((health) => health.alive && health.ready),
  );

const discoveredServerReady = (
  discovery: ControlDiscoveryService,
  client: ControlClientService,
  target: CliServerTarget,
) =>
  Effect.gen(function* () {
    const server = yield* discovery.discover(target);
    if (server._tag !== "Running") return false;
    return yield* serverHealthReady(client, server);
  });

export const waitForKnownReadyServer = Effect.fn("cli.readiness.waitForKnownReadyServer")(
  function* (input: {
    readonly server: CliRunningServer;
    readonly operation: Extract<CliWaitOperation, "start" | "restart">;
    readonly timeoutMessage: string;
  }) {
    const client = yield* ControlClient;
    const timing = yield* LifecycleTiming;

    yield* waitForReachable({
      check: serverHealthReady(client, input.server),
      timeoutMs: timing.startTimeoutMs,
      intervalMs: timing.pollIntervalMs,
      socketPath: input.server.socketPath,
      operation: input.operation,
      timeoutMessage: input.timeoutMessage,
    });
  },
);

export const waitForDiscoveredReadyServer = Effect.fn("cli.readiness.waitForDiscoveredReadyServer")(
  function* (input: {
    readonly target: CliServerTarget;
    readonly socketPath: string;
    readonly operation: Extract<CliWaitOperation, "start" | "restart">;
    readonly timeoutMessage: string;
  }) {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const timing = yield* LifecycleTiming;

    yield* waitForReachable({
      check: discoveredServerReady(discovery, client, input.target),
      timeoutMs: timing.startTimeoutMs,
      intervalMs: timing.pollIntervalMs,
      socketPath: input.socketPath,
      operation: input.operation,
      timeoutMessage: input.timeoutMessage,
    });

    return yield* discovery.requireRunning(input.target);
  },
);

const spawnedExitMessage = (input: {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly retryCommand: string;
  readonly logDir: string;
}): string => {
  const exitReason =
    input.exitCode === null
      ? `signal ${input.signalCode ?? "unknown"}`
      : `exit code ${input.exitCode}`;
  return `Spawned xmux server exited before it became ready (${exitReason}). Retry in the foreground: ${input.retryCommand}. Logs: ${input.logDir}`;
};

export const waitForSpawnedReadyServer = Effect.fn("cli.readiness.waitForSpawnedReadyServer")(
  function* (input: {
    readonly target: CliServerTarget;
    readonly socketPath: string;
    readonly logDir: string;
    readonly operation: Extract<CliWaitOperation, "start" | "restart">;
    readonly timeoutMessage: string;
    readonly retryCommand: string;
    readonly spawned: CliSpawnedProcess;
  }) {
    return yield* Effect.raceFirst(
      waitForDiscoveredReadyServer({
        target: input.target,
        socketPath: input.socketPath,
        operation: input.operation,
        timeoutMessage: input.timeoutMessage,
      }),
      input.spawned.exit.pipe(
        Effect.flatMap((exit) => {
          const exitCode = exit.exitCode === null ? {} : { exitCode: exit.exitCode };
          const signalCode = exit.signalCode === null ? {} : { signalCode: exit.signalCode };
          return Effect.fail(
            new CliSpawnedServerExited({
              message: spawnedExitMessage({
                exitCode: exit.exitCode,
                signalCode: exit.signalCode,
                retryCommand: input.retryCommand,
                logDir: input.logDir,
              }),
              operation: input.operation,
              retryCommand: input.retryCommand,
              logDir: input.logDir,
              ...exitCode,
              ...signalCode,
            }),
          );
        }),
      ),
    );
  },
);
