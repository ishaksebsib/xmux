import { spawn } from "node:child_process";
import { Effect, Layer } from "effect";
import { CliSpawnError } from "../../domain/errors";
import type { CliConfigPath } from "../../domain/input";
import {
  buildServerRunSpawnSpec,
  ProcessSpawner,
  type CliSpawnSpec,
  type CurrentCliProcess,
  type ProcessSpawnerService,
} from "../../process/spawn";

export const currentCliProcess = (): CurrentCliProcess => ({
  executablePath: process.execPath,
  entrypointPath: process.argv[1],
  env: process.env,
});

export const spawnDetached = (spec: CliSpawnSpec): Effect.Effect<void, CliSpawnError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(spec.command, [...spec.args], {
          detached: spec.detached,
          stdio: spec.stdio,
          env: spec.env,
        });

        const onSpawn = (): void => {
          child.off("error", onError);
          child.unref();
          resolve();
        };
        const onError = (cause: Error): void => {
          child.off("spawn", onSpawn);
          reject(cause);
        };

        child.once("spawn", onSpawn);
        child.once("error", onError);
      }),
    catch: (cause) =>
      new CliSpawnError({
        message: "Failed to start xmux server process.",
        command: spec.command,
        cause,
      }),
  });

const makeProcessSpawner = (): ProcessSpawnerService => ({
  buildServerRunSpawnSpec: Effect.fn("cli.spawn.service.buildServerRunSpawnSpec")(
    function* (input: { readonly configPath: CliConfigPath | undefined }) {
      const processInfo = yield* Effect.sync(currentCliProcess);
      const spec: CliSpawnSpec = yield* buildServerRunSpawnSpec({
        currentProcess: processInfo,
        configPath: input.configPath,
      });
      return spec;
    },
  ),
  spawnDetached,
});

export const nodeProcessSpawnerLayer = Layer.succeed(ProcessSpawner, makeProcessSpawner());
