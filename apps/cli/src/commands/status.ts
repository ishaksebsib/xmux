import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlClient } from "../control/client";
import { ConfigSummary } from "../control/config-summary";
import { ControlDiscovery } from "../control/discovery";
import { mapConfigPathError } from "./input";
import { parseServerTarget } from "../domain/input";
import {
  runningStatusReport,
  serverStatusPayloadFromResponse,
  statusReportFromInactiveDiscovery,
  type CliStatusReport,
} from "../domain/status";
import { getCliOutputCapabilities } from "../output/capabilities";
import { renderStatus } from "../output/status";
import { configPathFlag, jsonOutputFlag } from "./options";

interface StatusInput {
  readonly configPath: Option.Option<string>;
  readonly json: boolean;
}

export const getStatusReport = Effect.fn("cli.status.report")(function* (input: StatusInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );
  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const configSummary = yield* ConfigSummary;
    const server = yield* discovery.discover(target);

    if (server._tag !== "Running") {
      const configSummaryReport = yield* configSummary.load(server.paths.configPath);
      return statusReportFromInactiveDiscovery({
        discovery: server,
        configSummary: configSummaryReport,
      });
    }

    const status = yield* client.status(server);
    return runningStatusReport(server, serverStatusPayloadFromResponse(status));
  });

  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runStatusCommand = Effect.fn("cli.status")(function* (input: StatusInput) {
  const report: CliStatusReport = yield* getStatusReport(input);
  const capabilities = yield* getCliOutputCapabilities;
  yield* Console.log(renderStatus(report, input.json ? "json" : "human", capabilities));
});

export const statusCommand = Command.make(
  "status",
  {
    configPath: configPathFlag,
    json: jsonOutputFlag,
  },
  runStatusCommand,
).pipe(
  Command.withDescription("Show xmux server status."),
  Command.withShortDescription("Show server status."),
);
