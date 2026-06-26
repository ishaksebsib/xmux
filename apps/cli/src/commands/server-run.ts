import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { CliInvalidInput } from "../domain/errors";
import { parseConfigPathOption } from "../domain/input";
import { ServerRunner } from "../process/server-runner";
import { mapConfigPathError } from "./input";
import { configPathFlag } from "./options";

const foregroundFlag = Flag.boolean("foreground").pipe(
  Flag.withDescription("Run in the foreground process."),
);

interface ServerRunInput {
  readonly foreground: boolean;
  readonly configPath: Option.Option<string>;
}

export const runServerRunCommand = Effect.fn("cli.serverRun")(function* (input: ServerRunInput) {
  if (!input.foreground) {
    return yield* new CliInvalidInput({
      message: "Use --foreground to run the xmux server in this process.",
      field: "foreground",
    });
  }

  const configPath = yield* parseConfigPathOption(input.configPath).pipe(
    Effect.mapError(mapConfigPathError),
  );

  const serverRunner = yield* ServerRunner;
  yield* serverRunner.runForeground({ configPath });
});

export const serverRunCommand = Command.make(
  "run",
  {
    foreground: foregroundFlag,
    configPath: configPathFlag,
  },
  runServerRunCommand,
).pipe(
  Command.withDescription("Run the xmux server in the foreground."),
  Command.withShortDescription("Run the server."),
);

export const serverCommand = Command.make("server").pipe(
  Command.withDescription("Server process commands."),
  Command.withShortDescription("Server commands."),
  Command.withSubcommands([serverRunCommand]),
);
