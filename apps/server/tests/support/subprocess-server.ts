import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NodePath } from "@effect/platform-node";
import { Duration, Effect, Layer, Option, Schema, Scope } from "effect";
import { ServerBootConfig } from "../../src/config/boot";
import { resolvedPathFromString } from "../../src/contracts/primitives";
import { parseServerOptions } from "../../src/options";
import { resolveRuntimePaths, type ServerRuntimePaths } from "../../src/server-control/paths";
import { HostRuntime } from "../../src/platform/host";
import { requestShutdown } from "./client";
import { writeConfig } from "./config";
import { makeSandbox } from "./sandbox";
import { exists, waitForHealthReady } from "./wait";

const tail = (lines: ReadonlyArray<string>) => lines.slice(-80).join("");
const SHUTDOWN_REQUEST_TIMEOUT_MS = 2_000;
const SHUTDOWN_EXIT_TIMEOUT_MS = 3_000;
const SHUTDOWN_CLEANUP_TIMEOUT_MS = 2_000;
const SHUTDOWN_POLL_INTERVAL_MS = 20;

class SubprocessServerError extends Schema.TaggedErrorClass<SubprocessServerError>()(
  "SubprocessServerError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const isExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const waitForExit = (child: ChildProcess): Effect.Effect<void> =>
  Effect.promise(() => {
    if (isExited(child)) return Promise.resolve();
    return new Promise<void>((resolveExit) => {
      const onExit = () => resolveExit();
      child.once("exit", onExit);
      if (isExited(child)) {
        child.off("exit", onExit);
        resolveExit();
      }
    });
  });

const childState = (child: ChildProcess): string =>
  `exitCode=${child.exitCode ?? "null"} signalCode=${child.signalCode ?? "null"} killed=${String(child.killed)}`;

const waitForMissingPathWithin = (path: string, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const present = yield* exists(path);
      if (!present) return true;
      yield* Effect.sleep(Duration.millis(SHUTDOWN_POLL_INTERVAL_MS));
    }
    return false;
  });

const terminateProcess = (child: ChildProcess): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (isExited(child)) return;
    child.kill("SIGTERM");
    const exited = yield* Effect.timeoutOption(waitForExit(child), Duration.millis(1_000));
    if (exited._tag === "Some" || isExited(child)) return;
    child.kill("SIGKILL");
    yield* Effect.timeoutOption(waitForExit(child), Duration.millis(1_000)).pipe(Effect.ignore);
  });

const resolveExpectedPaths = (input: {
  readonly root: string;
  readonly configPath: string;
  readonly env: Record<string, string | undefined>;
}): Effect.Effect<ServerRuntimePaths, unknown> => {
  const host = Layer.succeed(HostRuntime)({
    platform: process.platform,
    homeDir: join(input.root, "home"),
    pid: process.pid,
    executablePath: process.execPath,
    randomUuid: () => Effect.succeed("subprocess-test"),
    isPidAlive: () => Effect.succeed(true),
    emitWarning: () => Effect.void,
  });
  const boot = Layer.succeed(ServerBootConfig)({
    xdgConfigHome:
      input.env.XDG_CONFIG_HOME === undefined
        ? Option.none()
        : Option.some(resolvedPathFromString(input.env.XDG_CONFIG_HOME)),
    xdgStateHome:
      input.env.XDG_STATE_HOME === undefined
        ? Option.none()
        : Option.some(resolvedPathFromString(input.env.XDG_STATE_HOME)),
    xdgRuntimeDir:
      input.env.XDG_RUNTIME_DIR === undefined
        ? Option.none()
        : Option.some(resolvedPathFromString(input.env.XDG_RUNTIME_DIR)),
  });
  return resolveRuntimePaths(parseServerOptions({ configPath: input.configPath })).pipe(
    Effect.provide(Layer.mergeAll(NodePath.layer, host, boot)),
  );
};

export const withSubprocessServer = <A>(
  input: { readonly config: string; readonly env?: Record<string, string> },
  use: (server: {
    readonly root: string;
    readonly configPath: string;
    readonly manifestPath: string;
    readonly socketPath: string;
    readonly paths: ServerRuntimePaths;
    readonly shutdown: Effect.Effect<void, unknown>;
    readonly output: Effect.Effect<{ readonly stdout: string; readonly stderr: string }>;
  }) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeSandbox;
    const configPath = join(sandbox.root, "config.jsonc");
    yield* writeConfig(configPath, input.config);
    yield* Effect.promise(() => mkdir(join(sandbox.root, "home"), { recursive: true }));
    const runnerPath = join(sandbox.root, "runner.mjs");
    const distPath = resolve("dist/platform/node.mjs");
    const effectPath = resolve("node_modules/effect/dist/Effect.js");
    yield* Effect.promise(() =>
      writeFile(
        runnerPath,
        `import * as Effect from ${JSON.stringify(effectPath)};\nimport { runXmuxServer } from ${JSON.stringify(distPath)};\nEffect.runPromise(runXmuxServer({ configPath: process.argv[2] })).catch((error) => { console.error(error); process.exitCode = 1; });\n`,
      ),
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => unlink(runnerPath)).pipe(Effect.ignore));
    const stdout: Array<string> = [];
    const stderr: Array<string> = [];
    const childEnv = {
      ...process.env,
      HOME: join(sandbox.root, "home"),
      XDG_CONFIG_HOME: join(sandbox.root, "xdg-config"),
      XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
      XDG_RUNTIME_DIR: join(sandbox.root, "xdg-runtime"),
      ...input.env,
    };
    const paths = yield* resolveExpectedPaths({ root: sandbox.root, configPath, env: childEnv });
    const child = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const proc = spawn(process.execPath, [runnerPath, configPath], {
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
        proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
        return proc;
      }),
      terminateProcess,
    );
    const diagnostics = (error: unknown) =>
      new SubprocessServerError({
        message: `${String(error)}\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}\nmanifest=${paths.manifestPath}\nsocket=${paths.controlEndpoint.path}\nlock=${paths.startupLockPath}`,
        cause: error,
      });
    yield* Effect.race(
      waitForHealthReady(paths.controlEndpoint.path).pipe(Effect.mapError(diagnostics)),
      waitForExit(child).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            diagnostics(
              `Subprocess exited before readiness: exitCode=${child.exitCode ?? "null"} signalCode=${child.signalCode ?? "null"}`,
            ),
          ),
        ),
      ),
    );
    let shutdownComplete = false;
    const shutdown = Effect.gen(function* () {
      if (shutdownComplete) return;

      if (!isExited(child)) {
        const requested = yield* Effect.timeoutOption(
          requestShutdown(paths.controlEndpoint.path),
          Duration.millis(SHUTDOWN_REQUEST_TIMEOUT_MS),
        );
        if (requested._tag === "None") {
          yield* terminateProcess(child);
          return yield* Effect.fail(
            `Shutdown request timed out after ${SHUTDOWN_REQUEST_TIMEOUT_MS}ms; ${childState(child)}`,
          );
        }
      }

      if (!isExited(child)) {
        const exited = yield* Effect.timeoutOption(
          waitForExit(child),
          Duration.millis(SHUTDOWN_EXIT_TIMEOUT_MS),
        );
        if (exited._tag === "None" && !isExited(child)) {
          yield* terminateProcess(child);
          return yield* Effect.fail(
            `Subprocess did not exit within ${SHUTDOWN_EXIT_TIMEOUT_MS}ms after shutdown; ${childState(child)}`,
          );
        }
      }

      const cleaned = yield* waitForMissingPathWithin(
        paths.manifestPath,
        SHUTDOWN_CLEANUP_TIMEOUT_MS,
      );
      if (!cleaned) {
        return yield* Effect.fail(
          `Manifest remained after subprocess shutdown for ${SHUTDOWN_CLEANUP_TIMEOUT_MS}ms; ${childState(child)}`,
        );
      }

      shutdownComplete = true;
    }).pipe(Effect.mapError(diagnostics));
    yield* Effect.addFinalizer(() => shutdown.pipe(Effect.ignore));
    return yield* use({
      root: sandbox.root,
      configPath,
      paths,
      manifestPath: paths.manifestPath,
      socketPath: paths.controlEndpoint.path,
      shutdown,
      output: Effect.sync(() => ({ stdout: tail(stdout), stderr: tail(stderr) })),
    });
  });
