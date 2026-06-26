import { Effect } from "effect";
import { ControlClient, type ControlClientService } from "../control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../control/discovery";
import type { CliRunningServer } from "../domain/discovery";
import type { CliWaitOperation } from "../domain/errors";
import type { CliServerTarget } from "../domain/input";
import { LifecycleTiming, waitForReachable } from "./wait";

export const serverHealthReady = (client: ControlClientService, server: CliRunningServer) =>
  client.health(server).pipe(
    Effect.catchTag("CliControlRequestError", () =>
      Effect.succeed({ alive: false, ready: false, state: "starting" as const }),
    ),
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
