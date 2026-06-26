import { Console, Effect, Option, References, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlClient } from "../control/client";
import { ControlDiscovery } from "../control/discovery";
import { CliInvalidInput } from "../domain/errors";
import { parseServerTarget } from "../domain/input";
import {
  stopReportFromInactiveDiscovery,
  stoppedReport,
  type CliStopReport,
} from "../domain/lifecycle";
import { renderStop } from "../output/lifecycle";
import { waitForUnreachable, LifecycleTiming } from "../process/wait";
import { configPathFlag } from "./options";

interface StopInput {
  readonly configPath: Option.Option<string>;
}

const mapConfigPathError = (cause: Schema.SchemaError): CliInvalidInput =>
  new CliInvalidInput({
    message: "Invalid --config path.",
    field: "config",
    cause,
  });

export const getStopReport = Effect.fn("cli.stop.report")(function* (input: StopInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );

  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const timing = yield* LifecycleTiming;
    const server = yield* discovery.discover(target);

    if (server._tag !== "Running") return stopReportFromInactiveDiscovery(server);

    const shutdown = yield* client.shutdown(server);
    yield* waitForUnreachable({
      check: client.health(server).pipe(
        Effect.map((health) => health.alive),
        Effect.catchTag("CliControlRequestError", () => Effect.succeed(true)),
      ),
      timeoutMs: timing.stopTimeoutMs,
      intervalMs: timing.pollIntervalMs,
      socketPath: server.socketPath,
      operation: "stop",
    });

    return stoppedReport(server, shutdown);
  });

  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runStopCommand = Effect.fn("cli.stop")(function* (input: StopInput) {
  const report: CliStopReport = yield* getStopReport(input);
  yield* Console.log(renderStop(report));
});

export const stopCommand = Command.make(
  "stop",
  {
    configPath: configPathFlag,
  },
  runStopCommand,
).pipe(
  Command.withDescription("Stop the xmux server gracefully."),
  Command.withShortDescription("Stop the server."),
);
