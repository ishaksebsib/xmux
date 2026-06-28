import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, Effect, Scope } from "effect";
import { cliRuntimeEnvForRoot } from "./env";
import { makeCliSandbox, type CliSandbox } from "./sandbox";
import { terminateProcess, waitForCondition } from "./subprocess";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const builtCliEntrypoint = resolve(packageRoot, "dist/bin/xmux.mjs");
const DEFAULT_RUN_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_CHARS = 4_000;

export interface CliProcessExit {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
}

export interface CapturedCliProcess {
  readonly child: ChildProcess;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly stdout: ReadonlyArray<string>;
  readonly stderr: ReadonlyArray<string>;
  readonly output: Effect.Effect<string>;
}

export interface CliRunResult extends CliProcessExit {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface InstalledCliHarness {
  readonly sandbox: CliSandbox;
  readonly binPath: string;
  readonly env: Record<string, string | undefined>;
  readonly runCli: (
    args: ReadonlyArray<string>,
    options?: { readonly timeoutMs?: number },
  ) => Effect.Effect<CliRunResult, never, Scope.Scope>;
  readonly spawnCli: (
    args: ReadonlyArray<string>,
  ) => Effect.Effect<CapturedCliProcess, never, Scope.Scope>;
}

const tail = (value: string): string =>
  value.length <= OUTPUT_TAIL_CHARS ? value : value.slice(value.length - OUTPUT_TAIL_CHARS);

export const formatCliRunResult = (result: CliRunResult): string =>
  [
    `command: ${result.command} ${result.args.join(" ")}`,
    `exitCode: ${result.exitCode ?? "null"}`,
    `signalCode: ${result.signalCode ?? "null"}`,
    `timedOut: ${String(result.timedOut)}`,
    "stdout:",
    tail(result.stdout),
    "stderr:",
    tail(result.stderr),
  ].join("\n");

export const isExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

export const waitForExit = (child: ChildProcess): Effect.Effect<CliProcessExit> =>
  Effect.callback<CliProcessExit>((resume) => {
    if (isExited(child)) {
      resume(Effect.succeed({ exitCode: child.exitCode, signalCode: child.signalCode }));
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

const makeInstalledBin = (root: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const binPath = join(root, "bin", "xmux");
    await mkdir(dirname(binPath), { recursive: true });
    await symlink(builtCliEntrypoint, binPath);
    return binPath;
  });

const spawnCaptured = (input: {
  readonly binPath: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
}): Effect.Effect<CapturedCliProcess, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const stdout: Array<string> = [];
      const stderr: Array<string> = [];
      const child = spawn(input.binPath, [...input.args], {
        cwd: packageRoot,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
      child.once("error", (cause) => stderr.push(`spawn error: ${cause.message}\n`));

      return {
        child,
        command: input.binPath,
        args: input.args,
        stdout,
        stderr,
        output: Effect.sync(() => `${stdout.join("")}${stderr.join("")}`),
      };
    }),
    ({ child }) => terminateProcess(child),
  );

const runCaptured = (input: {
  readonly binPath: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly timeoutMs: number;
}): Effect.Effect<CliRunResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const subprocess = yield* spawnCaptured({
      binPath: input.binPath,
      args: input.args,
      env: input.env,
    });
    const exit = yield* Effect.timeoutOption(
      waitForExit(subprocess.child),
      Duration.millis(input.timeoutMs),
    );

    const timedOut = exit._tag === "None";
    if (timedOut) {
      yield* terminateProcess(subprocess.child);
    }

    const exitState =
      exit._tag === "Some"
        ? exit.value
        : { exitCode: subprocess.child.exitCode, signalCode: subprocess.child.signalCode };

    return {
      command: subprocess.command,
      args: subprocess.args,
      exitCode: exitState.exitCode,
      signalCode: exitState.signalCode,
      stdout: subprocess.stdout.join(""),
      stderr: subprocess.stderr.join(""),
      timedOut,
    };
  });

export const makeInstalledCliHarness: Effect.Effect<InstalledCliHarness, never, Scope.Scope> =
  Effect.gen(function* () {
    const sandbox = yield* makeCliSandbox;
    const binPath = yield* makeInstalledBin(sandbox.root).pipe(Effect.orDie);
    const runtimeEnv = cliRuntimeEnvForRoot(sandbox.root);
    const pathPrefix = dirname(binPath);
    const env = {
      ...process.env,
      ...runtimeEnv,
      PATH: `${pathPrefix}:${process.env.PATH ?? ""}`,
    };

    return {
      sandbox,
      binPath,
      env,
      runCli: (args, options) =>
        runCaptured({
          binPath,
          args,
          env,
          timeoutMs: options?.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
        }),
      spawnCli: (args) => spawnCaptured({ binPath, args, env }),
    };
  });

export { terminateProcess, waitForCondition };
