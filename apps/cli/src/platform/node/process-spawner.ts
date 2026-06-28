import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { Effect, Layer } from "effect";
import { CliSpawnError } from "../../domain/errors";
import type { CliConfigPath } from "../../domain/input";
import {
  buildServerRunSpawnSpec,
  ProcessSpawner,
  type CliSpawnExit,
  type CliSpawnedProcess,
  type CliSpawnSpec,
  type CurrentCliProcess,
  type ProcessSpawnerService,
} from "../../process/spawn";

export const resolveCliEntrypointPath = (
  entrypointPath: string | undefined,
): string | undefined => {
  if (entrypointPath === undefined) return undefined;

  try {
    return realpathSync.native(entrypointPath);
  } catch {
    return entrypointPath;
  }
};

export const currentCliProcess = (): CurrentCliProcess => ({
  executablePath: process.execPath,
  entrypointPath: resolveCliEntrypointPath(process.argv[1]),
  env: process.env,
});

const childExitState = (child: ChildProcess): CliSpawnExit | undefined => {
  if (child.exitCode === null && child.signalCode === null) return undefined;
  return {
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  };
};

const waitForChildExit = (child: ChildProcess): Effect.Effect<CliSpawnExit> =>
  Effect.callback<CliSpawnExit>((resume) => {
    const exited = childExitState(child);
    if (exited !== undefined) {
      resume(Effect.succeed(exited));
      return Effect.void;
    }

    const onExit = (exitCode: number | null, signalCode: NodeJS.Signals | null): void => {
      resume(Effect.succeed({ exitCode, signalCode }));
    };

    child.once("exit", onExit);
    return Effect.sync(() => {
      child.off("exit", onExit);
    });
  });

export const spawnDetached = (
  spec: CliSpawnSpec,
): Effect.Effect<CliSpawnedProcess, CliSpawnError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<CliSpawnedProcess>((resolve, reject) => {
        const child = spawn(spec.command, [...spec.args], {
          detached: spec.detached,
          stdio: spec.stdio,
          env: spec.env,
        });

        const onSpawn = (): void => {
          child.off("error", onError);
          child.unref();
          resolve({
            pid: child.pid,
            exit: waitForChildExit(child),
          });
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
