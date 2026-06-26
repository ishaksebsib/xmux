import { runXmuxServer } from "@xmux/server/platform/node";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { CliInvalidInput, CliServerRunFailed, safeErrorReason } from "../domain/errors";
import { parseConfigPathOption, type CliConfigPath } from "../domain/input";
import { mapConfigPathError } from "./input";
import { configPathFlag } from "./options";

const foregroundFlag = Flag.boolean("foreground").pipe(
  Flag.withDescription("Run in the foreground process."),
);

interface ServerRunInput {
  readonly foreground: boolean;
  readonly configPath: Option.Option<string>;
}

const toServerOptions = (configPath: CliConfigPath | undefined) =>
  configPath === undefined ? {} : { configPath };

const safeErrorMessage = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  return "xmux server failed.";
};

const mapServerRunError = (cause: unknown): CliServerRunFailed =>
  new CliServerRunFailed({
    message: safeErrorMessage(cause),
    reason: safeErrorReason(cause),
    cause,
  });

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

  yield* runXmuxServer(toServerOptions(configPath)).pipe(
    Effect.mapError(mapServerRunError),
    Effect.asVoid,
  );
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
