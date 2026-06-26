import { runXmuxServer } from "@xmux/server/platform/node";
import { Effect, Layer } from "effect";
import { CliServerRunFailed, safeErrorReason } from "../../domain/errors";
import type { CliConfigPath } from "../../domain/input";
import { ServerRunner } from "../../process/server-runner";

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

export const nodeServerRunnerLayer = Layer.succeed(ServerRunner, {
  runForeground: Effect.fn("cli.serverRunner.runForeground")(function* (input: {
    readonly configPath: CliConfigPath | undefined;
  }) {
    yield* runXmuxServer(toServerOptions(input.configPath)).pipe(
      Effect.mapError(mapServerRunError),
      Effect.asVoid,
    );
  }),
});
