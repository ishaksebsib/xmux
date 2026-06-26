import { spawn } from "node:child_process";
import { Effect } from "effect";
import { CliSpawnError } from "../domain/errors";
import type { CliConfigPath } from "../domain/input";

export interface CliSpawnSpec {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly detached: true;
  readonly stdio: "ignore";
}

export interface CurrentCliProcess {
  readonly executablePath: string;
  readonly entrypointPath: string | undefined;
  readonly env: Record<string, string | undefined>;
}

export type CliEntrypointMode =
  | { readonly _tag: "BuiltExecutable" }
  | { readonly _tag: "NodeScript"; readonly scriptPath: string }
  | { readonly _tag: "UnsupportedSource"; readonly sourcePath: string };

const normalizeEntrypointPath = (entrypointPath: string): string =>
  entrypointPath.replaceAll("\\", "/");

export const classifyCliEntrypoint = (entrypointPath: string | undefined): CliEntrypointMode => {
  if (entrypointPath === undefined) return { _tag: "BuiltExecutable" };

  const normalized = normalizeEntrypointPath(entrypointPath);
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return { _tag: "NodeScript", scriptPath: entrypointPath };
  }
  if (normalized.endsWith(".ts") || normalized.endsWith(".mts") || normalized.endsWith(".cts")) {
    return { _tag: "UnsupportedSource", sourcePath: entrypointPath };
  }

  return { _tag: "BuiltExecutable" };
};

export const buildServerRunArgs = (configPath: CliConfigPath | undefined): ReadonlyArray<string> =>
  configPath === undefined
    ? ["server", "run", "--foreground"]
    : ["server", "run", "--foreground", "--config", configPath];

export const buildServerRunSpawnSpec = Effect.fn("cli.spawn.buildServerRunSpawnSpec")(
  function* (input: {
    readonly process: CurrentCliProcess;
    readonly configPath: CliConfigPath | undefined;
  }) {
    const serverArgs = buildServerRunArgs(input.configPath);
    const entrypoint = classifyCliEntrypoint(input.process.entrypointPath);

    switch (entrypoint._tag) {
      case "BuiltExecutable":
        return {
          command: input.process.executablePath,
          args: serverArgs,
          env: input.process.env,
          detached: true,
          stdio: "ignore",
        };
      case "NodeScript":
        return {
          command: input.process.executablePath,
          args: [entrypoint.scriptPath, ...serverArgs],
          env: input.process.env,
          detached: true,
          stdio: "ignore",
        };
      case "UnsupportedSource":
        return yield* new CliSpawnError({
          message: "Cannot auto-start xmux server from a TypeScript CLI entrypoint.",
          command: input.process.executablePath,
        });
    }
  },
);

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
