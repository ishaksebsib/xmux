import { Console, Effect, Option, References, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ControlClient, type CliLogsResponse } from "../control/client";
import { ControlDiscovery } from "../control/discovery";
import { CliInvalidInput } from "../domain/errors";
import { mapConfigPathError } from "./input";
import { parseServerTarget, parseTailCount, type CliTailCount } from "../domain/input";
import { logsReport, type CliLogsReport } from "../domain/logs";
import { getCliOutputCapabilities } from "../output/capabilities";
import { renderLogs } from "../output/logs";
import { configPathFlag, jsonOutputFlag } from "./options";

interface LogsInput {
  readonly configPath: Option.Option<string>;
  readonly tail: Option.Option<number>;
  readonly json: boolean;
}

const tailFlag = Flag.integer("tail").pipe(
  Flag.optional,
  Flag.withDescription("Number of recent server log entries to print."),
);

const mapTailError = (cause: Schema.SchemaError): CliInvalidInput =>
  new CliInvalidInput({
    message: "Invalid --tail value. Expected a positive integer.",
    field: "tail",
    cause,
  });

const undefinedTailCount = Effect.sync((): undefined => undefined);

const parseTailOption = (
  tail: Option.Option<number>,
): Effect.Effect<CliTailCount | undefined, Schema.SchemaError> =>
  Option.match(tail, {
    onNone: () => undefinedTailCount,
    onSome: parseTailCount,
  });

export const getLogsReport = Effect.fn("cli.logs.report")(function* (input: LogsInput) {
  const target = yield* parseServerTarget(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );
  const tail = yield* parseTailOption(input.tail).pipe(Effect.mapError(mapTailError));

  const report = Effect.gen(function* () {
    const discovery = yield* ControlDiscovery;
    const client = yield* ControlClient;
    const server = yield* discovery.requireRunning(target);
    const response = yield* client.logs(server, tail);
    return logsReport(server, response);
  });

  // Keep command stdout/stderr deterministic; JSON mode requires it, and human
  // mode should remain concise rather than interleaving Effect diagnostics.
  return yield* report.pipe(Effect.provideService(References.MinimumLogLevel, "None"));
});

export const runLogsCommand = Effect.fn("cli.logs")(function* (input: LogsInput) {
  const report: CliLogsReport<CliLogsResponse> = yield* getLogsReport(input);
  const capabilities = yield* getCliOutputCapabilities;
  yield* Console.log(renderLogs(report, input.json ? "json" : "human", capabilities));
});

export const logsCommand = Command.make(
  "logs",
  {
    configPath: configPathFlag,
    tail: tailFlag,
    json: jsonOutputFlag,
  },
  runLogsCommand,
).pipe(
  Command.withDescription("Show recent xmux server logs."),
  Command.withShortDescription("Show server logs."),
);
