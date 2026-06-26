import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import { ControlClient, type CliStatusResponse } from "../control/client";
import { ControlDiscovery } from "../control/discovery";
import { mapConfigPathError } from "./input";
import { parseServerTarget } from "../domain/input";
import {
  CliServerStatusEndpoint,
  CliServerStatusPayload,
  runningStatusReport,
  statusReportFromInactiveDiscovery,
  type CliStatusReport,
} from "../domain/status";
import { renderStatus } from "../output/status";
import { configPathFlag, jsonOutputFlag } from "./options";

interface StatusInput {
  readonly configPath: Option.Option<string>;
  readonly json: boolean;
}

const statusPayloadFromResponse = (status: CliStatusResponse): CliServerStatusPayload =>
  new CliServerStatusPayload({
    version: status.version,
    protocolVersion: status.protocolVersion,
    pid: status.pid,
    startedAt: status.startedAt,
    uptimeMs: status.uptimeMs,
    state: status.state,
    configPath: status.configPath,
    stateDir: status.stateDir,
    scopeId: status.scopeId,
    endpoint: new CliServerStatusEndpoint({
      kind: status.endpoint.kind,
      path: status.endpoint.path,
    }),
  });

export const getStatusReport = Effect.fn("cli.status.report")(function* (input: StatusInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );
  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const server = yield* discovery.discover(target);

    if (server._tag !== "Running") return statusReportFromInactiveDiscovery(server);

    const status = yield* client.status(server);
    return runningStatusReport(server, statusPayloadFromResponse(status));
  });

  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runStatusCommand = Effect.fn("cli.status")(function* (input: StatusInput) {
  const report: CliStatusReport = yield* getStatusReport(input);
  yield* Console.log(renderStatus(report, input.json ? "json" : "human"));
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
