import { Context, Effect } from "effect";
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

const detachedSpawnSpec = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
}): CliSpawnSpec => ({
  command: input.command,
  args: input.args,
  env: input.env,
  detached: true,
  stdio: "ignore",
});

export const buildServerRunSpawnSpec = Effect.fn("cli.spawn.buildServerRunSpawnSpec")(
  function* (input: {
    readonly currentProcess: CurrentCliProcess;
    readonly configPath: CliConfigPath | undefined;
  }) {
    const serverArgs = buildServerRunArgs(input.configPath);
    const entrypoint = classifyCliEntrypoint(input.currentProcess.entrypointPath);

    switch (entrypoint._tag) {
      case "BuiltExecutable":
        return detachedSpawnSpec({
          command: input.currentProcess.executablePath,
          args: serverArgs,
          env: input.currentProcess.env,
        });
      case "NodeScript":
        return detachedSpawnSpec({
          command: input.currentProcess.executablePath,
          args: [entrypoint.scriptPath, ...serverArgs],
          env: input.currentProcess.env,
        });
      case "UnsupportedSource":
        return yield* new CliSpawnError({
          message: "Cannot auto-start xmux server from a TypeScript CLI entrypoint.",
          command: input.currentProcess.executablePath,
        });
    }
  },
);

export interface ProcessSpawnerService {
  readonly buildServerRunSpawnSpec: (input: {
    readonly configPath: CliConfigPath | undefined;
  }) => Effect.Effect<CliSpawnSpec, CliSpawnError>;
  readonly spawnDetached: (spec: CliSpawnSpec) => Effect.Effect<void, CliSpawnError>;
}

export class ProcessSpawner extends Context.Service<ProcessSpawner, ProcessSpawnerService>()(
  "@xmux/cli/ProcessSpawner",
) {}
