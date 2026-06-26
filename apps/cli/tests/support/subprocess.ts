import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { Duration, Effect, Scope } from "effect";

export interface CapturedSubprocess {
  readonly child: ChildProcess;
  readonly stdout: ReadonlyArray<string>;
  readonly stderr: ReadonlyArray<string>;
  readonly output: Effect.Effect<string>;
}

export const isExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

export const waitForExit = (child: ChildProcess): Effect.Effect<void> =>
  Effect.promise(() => {
    if (isExited(child)) return Promise.resolve();
    return new Promise<void>((resolveExit) => {
      child.once("exit", () => resolveExit());
    });
  });

export const terminateProcess = (child: ChildProcess): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (isExited(child)) return;
    child.kill("SIGTERM");
    const exited = yield* Effect.timeoutOption(waitForExit(child), Duration.seconds(2));
    if (exited._tag === "Some" || isExited(child)) return;
    child.kill("SIGKILL");
    yield* waitForExit(child).pipe(Effect.timeoutOption(Duration.seconds(2)), Effect.ignore);
  });

export const spawnForegroundCli = (input: {
  readonly configPath: string;
  readonly env: Record<string, string | undefined>;
}): Effect.Effect<CapturedSubprocess, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const stdout: Array<string> = [];
      const stderr: Array<string> = [];
      const child = spawn(
        process.execPath,
        [
          resolve("dist/bin/xmux.mjs"),
          "server",
          "run",
          "--foreground",
          "--config",
          input.configPath,
        ],
        { env: input.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
      return {
        child,
        stdout,
        stderr,
        output: Effect.sync(() => `${stdout.join("")}${stderr.join("")}`),
      };
    }),
    ({ child }) => terminateProcess(child),
  );

export const waitForCondition = (input: {
  readonly check: Effect.Effect<boolean>;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() <= deadline) {
      if (yield* input.check) return true;
      yield* Effect.sleep(Duration.millis(input.intervalMs ?? 25));
    }
    return false;
  });
