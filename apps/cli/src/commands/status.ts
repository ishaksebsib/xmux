import { Console, Effect, Option, References } from "effect";
import { Command } from "effect/unstable/cli";
import {
  ControlClient,
  type CliChatAdapterStatus as CliChatAdapterStatusResponse,
  type CliHarnessAdapterStatus as CliHarnessAdapterStatusResponse,
  type CliStatusResponse,
} from "../control/client";
import { ConfigSummary } from "../control/config-summary";
import { ControlDiscovery } from "../control/discovery";
import { mapConfigPathError } from "./input";
import { parseServerTarget } from "../domain/input";
import {
  CliChatAdapterStatus,
  CliHarnessAdapterStatus,
  CliOrchestratorStatus,
  CliServerStatusEndpoint,
  CliServerStatusPayload,
  cliSafeStatusReasonFromString,
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

const chatAdapterStatusFromResponse = (
  adapter: CliChatAdapterStatusResponse,
): CliChatAdapterStatus =>
  new CliChatAdapterStatus(
    adapter.reason === undefined
      ? { id: adapter.id, state: adapter.state }
      : {
          id: adapter.id,
          state: adapter.state,
          reason: cliSafeStatusReasonFromString(adapter.reason),
        },
  );

const harnessAdapterStatusFromResponse = (
  adapter: CliHarnessAdapterStatusResponse,
): CliHarnessAdapterStatus =>
  new CliHarnessAdapterStatus(
    adapter.reason === undefined
      ? { id: adapter.id, state: adapter.state }
      : {
          id: adapter.id,
          state: adapter.state,
          reason: cliSafeStatusReasonFromString(adapter.reason),
        },
  );

const unknownOrchestratorStatus = new CliOrchestratorStatus({
  state: "not_started",
  activation: "unknown",
  chats: [],
  harnesses: [],
});

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
    orchestrator:
      status.orchestrator === undefined
        ? unknownOrchestratorStatus
        : new CliOrchestratorStatus(
            status.orchestrator.reason === undefined
              ? {
                  state: status.orchestrator.state,
                  activation: status.orchestrator.activation,
                  chats: status.orchestrator.chats.map(chatAdapterStatusFromResponse),
                  harnesses: status.orchestrator.harnesses.map(harnessAdapterStatusFromResponse),
                }
              : {
                  state: status.orchestrator.state,
                  activation: status.orchestrator.activation,
                  chats: status.orchestrator.chats.map(chatAdapterStatusFromResponse),
                  harnesses: status.orchestrator.harnesses.map(harnessAdapterStatusFromResponse),
                  reason: cliSafeStatusReasonFromString(status.orchestrator.reason),
                },
          ),
  });

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
