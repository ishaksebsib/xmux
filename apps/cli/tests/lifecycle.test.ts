import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Scope, Semaphore } from "effect";
import { getRestartReport } from "../src/commands/restart";
import { getStartReport } from "../src/commands/start";
import { getStopReport } from "../src/commands/stop";
import {
  ControlClient,
  type CliHealthResponse,
  type CliShutdownResponse,
  type ControlClientService,
} from "../src/control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../src/control/discovery";
import {
  CliInvalidManifest,
  CliStaleManifestCleanedServer,
  CliStoppedServer,
  CliWrongScopeServer,
  type CliResolvedServerPaths,
  type CliRunningServer,
} from "../src/domain/discovery";
import {
  CliControlRequestError,
  CliDiscoveryError,
  CliInvalidInput,
  CliServerUnreachable,
  CliSpawnError,
  CliSpawnedServerExited,
} from "../src/domain/errors";
import { parsePollIntervalMs, parseTimeoutMs } from "../src/domain/input";
import { renderCliCause } from "../src/output/errors";
import { renderRestart, renderStart, renderStop } from "../src/output/lifecycle";
import { nodeControlClientLayer } from "../src/platform/node/control-client";
import { nodeControlDiscoveryLayer } from "../src/platform/node/control-discovery";
import {
  ProcessSpawner,
  type CliSpawnExit,
  type CliSpawnedProcess,
  type CliSpawnSpec,
  type ProcessSpawnerService,
} from "../src/process/spawn";
import { StartLock, type StartLockService } from "../src/process/start-lock";
import { LifecycleTiming } from "../src/process/wait";
import { runningServer } from "./support/client";
import { bindShutdownServer, resolvePaths, writeServerManifest } from "./support/discovery";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox, writeText } from "./support/sandbox";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const readyHealth: CliHealthResponse = { alive: true, ready: true, state: "ready" };
const acceptedShutdown: CliShutdownResponse = { accepted: true, alreadyStopping: false };

const spawnSpec: CliSpawnSpec = {
  command: "/usr/bin/xmux",
  args: ["server", "run", "--foreground"],
  env: {},
  detached: true,
  stdio: "ignore",
};

const timingLayer = (input: {
  readonly startTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}) =>
  Layer.effect(
    LifecycleTiming,
    Effect.gen(function* () {
      const startTimeoutMs = yield* parseTimeoutMs(input.startTimeoutMs ?? 25).pipe(Effect.orDie);
      const stopTimeoutMs = yield* parseTimeoutMs(input.stopTimeoutMs ?? 25).pipe(Effect.orDie);
      const pollIntervalMs = yield* parsePollIntervalMs(input.pollIntervalMs ?? 1).pipe(
        Effect.orDie,
      );
      return { startTimeoutMs, stopTimeoutMs, pollIntervalMs };
    }),
  );

const stopped = (paths: CliResolvedServerPaths): CliStoppedServer =>
  new CliStoppedServer({ _tag: "Stopped", paths });

const invalidManifest = (paths: CliResolvedServerPaths): CliInvalidManifest =>
  new CliInvalidManifest({ _tag: "InvalidManifest", paths, reason: "invalid_json" });

const wrongScope = (paths: CliResolvedServerPaths): CliWrongScopeServer =>
  new CliWrongScopeServer({ _tag: "WrongScope", paths });

const staleCleaned = (paths: CliResolvedServerPaths): CliStaleManifestCleanedServer =>
  new CliStaleManifestCleanedServer({ _tag: "StaleManifestCleaned", paths });

const discoveryLayer = (service: ControlDiscoveryService) =>
  Layer.succeed(ControlDiscovery, service);

const clientLayer = (service: ControlClientService) => Layer.succeed(ControlClient, service);

const spawnerLayer = (service: ProcessSpawnerService) => Layer.succeed(ProcessSpawner, service);

const noOpStartLock: StartLockService = {
  acquire: (paths) =>
    Effect.succeed({
      path: `${paths.startupLockPath}.cli-start`,
      pid: process.pid,
      nonce: "test-lock",
      scopeId: paths.scopeId,
    }),
  release: () => Effect.void,
  withLock: (_paths, use) => use,
};

const startLockLayer = (service: StartLockService = noOpStartLock) =>
  Layer.succeed(StartLock, service);

const makeClient = (input: {
  readonly health?: (server: CliRunningServer) => Effect.Effect<CliHealthResponse, never>;
  readonly shutdown?: (server: CliRunningServer) => Effect.Effect<CliShutdownResponse, never>;
}): ControlClientService => ({
  health: input.health ?? (() => Effect.succeed(readyHealth)),
  status: () => Effect.die("status should not be called"),
  logs: () => Effect.die("logs should not be called"),
  shutdown: input.shutdown ?? (() => Effect.succeed(acceptedShutdown)),
});

const spawnedProcess = (exit: Effect.Effect<CliSpawnExit> = Effect.never): CliSpawnedProcess => ({
  pid: 12345,
  exit,
});

const makeSpawner = (input: {
  readonly build?: () => Effect.Effect<CliSpawnSpec, CliSpawnError>;
  readonly spawn?: (spec: CliSpawnSpec) => Effect.Effect<CliSpawnedProcess, CliSpawnError>;
}): ProcessSpawnerService => ({
  buildServerRunSpawnSpec: () => input.build?.() ?? Effect.succeed(spawnSpec),
  spawnDetached: (spec) => input.spawn?.(spec) ?? Effect.succeed(spawnedProcess()),
});

const withLifecycleSandbox = <A, E, R>(
  run: (input: { readonly root: string; readonly configPath: string }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeCliSandbox;
    const configPath = join(sandbox.root, "config.jsonc");
    return yield* withEnvVars(
      cliRuntimeEnvForRoot(sandbox.root),
      run({ root: sandbox.root, configPath }),
    );
  });

describe.sequential("stop command", () => {
  posixIt("renders stopped/no manifest idempotently", () =>
    withLifecycleSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const report = yield* getStopReport({ configPath: Option.some(configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer, timingLayer({})),
          ),
        );
        const output = renderStop(report);

        expect(report._tag).toBe("AlreadyStopped");
        expect(output).toContain("xmux server: already stopped");
        expect(output).toContain("reason: no-manifest");
      }),
    ),
  );

  posixIt("keeps invalid manifests explicit without shutdown", () =>
    withLifecycleSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeText(paths.manifestPath, "not json");
        const report = yield* getStopReport({ configPath: Option.some(configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer, timingLayer({})),
          ),
        );

        expect(report._tag).toBe("InvalidManifest");
        expect(renderStop(report)).toContain("xmux server: invalid-manifest");
      }),
    ),
  );

  posixIt("keeps stale manifests explicit without shutdown", () =>
    withLifecycleSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { sessionId: "stale-stop" });
        const report = yield* getStopReport({ configPath: Option.some(configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer, timingLayer({})),
          ),
        );

        expect(report._tag).toBe("StaleManifestCleaned");
        expect(renderStop(report)).toContain("xmux server: stale-manifest-cleaned");
      }),
    ),
  );

  posixIt("keeps wrong-scope manifests explicit without shutdown", () =>
    withLifecycleSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { scopeId: "wrong-scope" });
        const report = yield* getStopReport({ configPath: Option.some(configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer, timingLayer({})),
          ),
        );

        expect(report._tag).toBe("WrongScope");
        expect(renderStop(report)).toContain("xmux server: wrong-scope");
      }),
    ),
  );

  posixIt("calls shutdown and waits for the socket to become unreachable", () =>
    withLifecycleSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        let shutdownCalled = false;
        yield* bindShutdownServer(paths, () => {
          shutdownCalled = true;
        });
        yield* writeServerManifest(paths, { sessionId: "active-stop" });

        const report = yield* getStopReport({ configPath: Option.some(configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer, timingLayer({})),
          ),
        );

        expect(report._tag).toBe("Stopped");
        expect(shutdownCalled).toBe(true);
        expect(renderStop(report)).toContain("xmux server: stopped");
      }),
    ),
  );

  it.effect("propagates shutdown request failures", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-stop-failure.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };
      const client: ControlClientService = {
        ...makeClient({}),
        shutdown: () =>
          Effect.fail(
            new CliControlRequestError({
              message: "shutdown failed",
              operation: "shutdown",
              socketPath: server.socketPath,
            }),
          ),
      };

      const exit = yield* Effect.exit(
        getStopReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(discoveryLayer(discovery), clientLayer(client), timingLayer({})),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.live("returns CliWaitTimeout when shutdown does not become unreachable", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-stop-timeout.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStopReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              timingLayer({ stopTimeoutMs: 1 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toHaveProperty("_tag", "CliWaitTimeout");
        expect(failure).toHaveProperty("operation", "stop");
      }
    }),
  );
});

describe("start command", () => {
  it.effect("does not spawn when a ready server is already running", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-running.sock");
      let spawned = false;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };

      const report = yield* getStartReport({
        configPath: Option.some(server.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(makeClient({})),
            spawnerLayer(
              makeSpawner({
                spawn: () =>
                  Effect.sync(() => {
                    spawned = true;
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            startLockLayer(),
          ),
        ),
      );

      expect(report._tag).toBe("AlreadyRunning");
      expect(spawned).toBe(false);
      expect(renderStart(report)).toContain("xmux server: already running");
    }),
  );

  it.effect("does not time out when an already running server is degraded but control-ready", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-degraded.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };

      const report = yield* getStartReport({
        configPath: Option.some(server.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(
              makeClient({
                health: () => Effect.succeed({ alive: true, ready: true, state: "degraded" }),
              }),
            ),
            spawnerLayer(makeSpawner({})),
            timingLayer({ startTimeoutMs: 1 }),
            startLockLayer(),
          ),
        ),
      );

      expect(report._tag).toBe("AlreadyRunning");
      expect(renderStart(report)).toContain("xmux server: already running");
    }),
  );

  it.effect("serializes concurrent starts so only one foreground server is spawned", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-concurrent.sock");
      let running = false;
      let spawnCount = 0;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.sync(() => (running ? server : stopped(server.paths))),
        requireRunning: () => Effect.succeed(server),
      };
      const serialStartLockLayer = Layer.effect(
        StartLock,
        Effect.gen(function* () {
          const semaphore = yield* Semaphore.make(1);
          const withLock: StartLockService["withLock"] = (_paths, use) =>
            Semaphore.withPermit(semaphore, use);
          return { ...noOpStartLock, withLock };
        }),
      );

      const reports = yield* Effect.all(
        [
          getStartReport({ configPath: Option.some(server.paths.configPath) }),
          getStartReport({ configPath: Option.some(server.paths.configPath) }),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(makeClient({})),
            spawnerLayer(
              makeSpawner({
                spawn: () =>
                  Effect.sync(() => {
                    spawnCount += 1;
                    running = true;
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            serialStartLockLayer,
          ),
        ),
      );

      expect(spawnCount).toBe(1);
      expect(reports.map((report) => report._tag).sort()).toEqual(["AlreadyRunning", "Started"]);
    }),
  );

  it.effect("does not spawn when a server becomes active after acquiring the start lock", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-active-after-lock.sock");
      let discoverCount = 0;
      let spawned = false;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () =>
          Effect.sync(() => {
            discoverCount += 1;
            return discoverCount === 1 ? stopped(server.paths) : server;
          }),
        requireRunning: () => Effect.succeed(server),
      };

      const report = yield* getStartReport({
        configPath: Option.some(server.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(makeClient({})),
            spawnerLayer(
              makeSpawner({
                spawn: () =>
                  Effect.sync(() => {
                    spawned = true;
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            startLockLayer(),
          ),
        ),
      );

      expect(report._tag).toBe("AlreadyRunning");
      expect(spawned).toBe(false);
    }),
  );

  it.effect("spawns the foreground server command from stopped state and waits for readiness", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-stopped.sock");
      let discoverCount = 0;
      let spawnedSpec: CliSpawnSpec | undefined;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () =>
          Effect.sync(() => {
            discoverCount += 1;
            return discoverCount <= 2 ? stopped(server.paths) : server;
          }),
        requireRunning: () => Effect.succeed(server),
      };

      const report = yield* getStartReport({
        configPath: Option.some(server.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(makeClient({})),
            spawnerLayer(
              makeSpawner({
                spawn: (spec) =>
                  Effect.sync(() => {
                    spawnedSpec = spec;
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            startLockLayer(),
          ),
        ),
      );

      expect(report._tag).toBe("Started");
      expect(spawnedSpec?.args).toEqual(["server", "run", "--foreground"]);
      expect(renderStart(report)).toContain("previous state: no-manifest");
    }),
  );

  it.effect("proceeds explicitly after stale-cleaned discovery", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-stale.sock");
      let discoverCount = 0;
      let spawned = false;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () =>
          Effect.sync(() => {
            discoverCount += 1;
            return discoverCount <= 2 ? staleCleaned(server.paths) : server;
          }),
        requireRunning: () => Effect.succeed(server),
      };

      const report = yield* getStartReport({
        configPath: Option.some(server.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(makeClient({})),
            spawnerLayer(
              makeSpawner({
                spawn: () =>
                  Effect.sync(() => {
                    spawned = true;
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            startLockLayer(),
          ),
        ),
      );

      expect(spawned).toBe(true);
      expect(report._tag).toBe("Started");
      expect(renderStart(report)).toContain("previous state: stale-manifest-removed");
    }),
  );

  it.effect("does not spawn for invalid or wrong-scope manifests", () =>
    Effect.gen(function* () {
      const invalidServer = runningServer("/tmp/xmux-start-invalid.sock");
      const wrongServer = runningServer("/tmp/xmux-start-wrong.sock");

      const runCase = (
        initial: CliInvalidManifest | CliWrongScopeServer,
        server: CliRunningServer,
      ) => {
        let spawned = false;
        const discovery: ControlDiscoveryService = {
          resolvePaths: () => Effect.succeed(server.paths),
          readManifest: () => Effect.die("readManifest should not be called"),
          discover: () => Effect.succeed(initial),
          requireRunning: () => Effect.succeed(server),
        };
        const exit = Effect.exit(
          getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
            Effect.provide(
              Layer.mergeAll(
                discoveryLayer(discovery),
                clientLayer(makeClient({})),
                spawnerLayer(
                  makeSpawner({
                    spawn: () =>
                      Effect.sync(() => {
                        spawned = true;
                        return spawnedProcess();
                      }),
                  }),
                ),
                timingLayer({}),
                startLockLayer(),
              ),
            ),
          ),
        );
        return Effect.map(exit, (result) => ({ result, spawned }));
      };

      const invalid = yield* runCase(invalidManifest(invalidServer.paths), invalidServer);
      const wrong = yield* runCase(wrongScope(wrongServer.paths), wrongServer);

      expect(Exit.isFailure(invalid.result)).toBe(true);
      expect(Exit.isFailure(wrong.result)).toBe(true);
      if (Exit.isFailure(invalid.result)) {
        expect(Cause.squash(invalid.result.cause)).toHaveProperty("_tag", "CliLifecycleBlocked");
        expect(renderCliCause(invalid.result.cause, false)).toContain("manifest is invalid");
      }
      if (Exit.isFailure(wrong.result)) {
        expect(Cause.squash(wrong.result.cause)).toHaveProperty("_tag", "CliLifecycleBlocked");
        expect(renderCliCause(wrong.result.cause, false)).toContain("another scope");
      }
      expect(invalid.spawned).toBe(false);
      expect(wrong.spawned).toBe(false);
    }),
  );

  it.effect("returns CliSpawnError on spawn failure", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-spawn-failure.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.fail(
                      new CliSpawnError({
                        message: "spawn failed",
                        command: "/usr/bin/xmux",
                      }),
                    ),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(CliSpawnError);
      }
    }),
  );

  it.effect("reports early spawned server exit before readiness timeout", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-early-exit.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.succeed(
                      spawnedProcess(Effect.succeed({ exitCode: 1, signalCode: null })),
                    ),
                }),
              ),
              timingLayer({ startTimeoutMs: 1_000 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliSpawnedServerExited);
        expect(failure).toHaveProperty("operation", "start");
        expect(failure).toHaveProperty("exitCode", 1);
        expect(renderCliCause(exit.cause, false)).toContain("exited before it became ready");
        expect(renderCliCause(exit.cause, false)).toContain("xmux server run --foreground");
        expect(renderCliCause(exit.cause, false)).toContain(server.paths.logDir);
      }
    }),
  );

  it.live("returns CliWaitTimeout when spawned server does not become ready", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-timeout.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(makeSpawner({})),
              timingLayer({ startTimeoutMs: 1 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toHaveProperty("_tag", "CliWaitTimeout");
        expect(failure).toHaveProperty("operation", "start");
        expect(renderCliCause(exit.cause, false)).toContain("Retry in the foreground");
      }
    }),
  );

  it.live("uses an active-server timeout message without foreground retry guidance", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-existing-timeout.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(
                makeClient({
                  health: () => Effect.succeed({ alive: true, ready: false, state: "starting" }),
                }),
              ),
              spawnerLayer(makeSpawner({})),
              timingLayer({ startTimeoutMs: 1 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const message = renderCliCause(exit.cause, false);
        expect(message).toContain("active xmux server");
        expect(message).not.toContain("Retry in the foreground");
      }
    }),
  );

  it.effect("propagates discovery failures while waiting for spawned readiness", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-start-discovery-failure.sock");
      let discoverCount = 0;
      const discoveryError = new CliDiscoveryError({
        message: "discovery failed during startup",
        reason: "test",
      });
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () =>
          Effect.sync(() => {
            discoverCount += 1;
            return discoverCount;
          }).pipe(
            Effect.flatMap((count) =>
              count <= 2 ? Effect.succeed(stopped(server.paths)) : Effect.fail(discoveryError),
            ),
          ),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(makeSpawner({})),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBe(discoveryError);
      }
    }),
  );
});

describe("restart command", () => {
  it.effect("stops a running server before spawning and waiting for readiness", () =>
    Effect.gen(function* () {
      const oldServer = runningServer("/tmp/xmux-restart-old.sock");
      const newServer = runningServer("/tmp/xmux-restart-new.sock");
      const events: Array<string> = [];
      let discoverCount = 0;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(oldServer.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () =>
          Effect.sync(() => {
            discoverCount += 1;
            events.push(`discover-${discoverCount}`);
            return discoverCount <= 2 ? oldServer : newServer;
          }),
        requireRunning: () =>
          Effect.sync(() => {
            events.push("require-running");
            return newServer;
          }),
      };
      const client: ControlClientService = {
        ...makeClient({}),
        health: (server) =>
          Effect.sync(() => {
            events.push(server.socketPath === oldServer.socketPath ? "health-old" : "health-new");
            return server.socketPath === oldServer.socketPath ? "old" : "new";
          }).pipe(
            Effect.flatMap((kind) =>
              kind === "old"
                ? Effect.fail(
                    new CliServerUnreachable({
                      message: "old endpoint closed",
                      socketPath: oldServer.socketPath,
                      operation: "health",
                    }),
                  )
                : Effect.succeed(readyHealth),
            ),
          ),
        shutdown: () =>
          Effect.sync(() => {
            events.push("shutdown");
            return acceptedShutdown;
          }),
      };

      const report = yield* getRestartReport({
        configPath: Option.some(oldServer.paths.configPath),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            discoveryLayer(discovery),
            clientLayer(client),
            spawnerLayer(
              makeSpawner({
                build: () =>
                  Effect.sync(() => {
                    events.push("build");
                    return spawnSpec;
                  }),
                spawn: () =>
                  Effect.sync(() => {
                    events.push("spawn");
                    return spawnedProcess();
                  }),
              }),
            ),
            timingLayer({}),
            startLockLayer(),
          ),
        ),
      );

      expect(report._tag).toBe("Restarted");
      expect(events).toEqual([
        "discover-1",
        "discover-2",
        "shutdown",
        "health-old",
        "build",
        "spawn",
        "discover-3",
        "health-new",
        "require-running",
      ]);
      expect(renderRestart(report)).toContain("xmux server: restarted");
    }),
  );

  it.effect("aborts without spawning when shutdown request fails", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-restart-shutdown-failure.sock");
      let spawned = false;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };
      const client: ControlClientService = {
        ...makeClient({}),
        shutdown: () =>
          Effect.fail(
            new CliControlRequestError({
              message: "shutdown failed",
              operation: "shutdown",
              socketPath: server.socketPath,
            }),
          ),
      };

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(client),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.sync(() => {
                      spawned = true;
                      return spawnedProcess();
                    }),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(spawned).toBe(false);
    }),
  );

  it.live("aborts without spawning when shutdown wait times out", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-restart-stop-timeout.sock");
      let spawned = false;
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.sync(() => {
                      spawned = true;
                      return spawnedProcess();
                    }),
                }),
              ),
              timingLayer({ stopTimeoutMs: 1 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toHaveProperty("_tag", "CliWaitTimeout");
        expect(failure).toHaveProperty("operation", "restart");
      }
      expect(spawned).toBe(false);
    }),
  );

  it.effect("starts from stopped or stale-cleaned inactive states", () =>
    Effect.gen(function* () {
      const stoppedServer = runningServer("/tmp/xmux-restart-stopped.sock");
      const staleServer = runningServer("/tmp/xmux-restart-stale.sock");

      const runCase = (initial: CliStoppedServer | CliStaleManifestCleanedServer) => {
        let discoverCount = 0;
        let spawned = false;
        const server =
          initial.paths.socketPath === stoppedServer.paths.socketPath ? stoppedServer : staleServer;
        const discovery: ControlDiscoveryService = {
          resolvePaths: () => Effect.succeed(server.paths),
          readManifest: () => Effect.die("readManifest should not be called"),
          discover: () =>
            Effect.sync(() => {
              discoverCount += 1;
              return discoverCount <= 2 ? initial : server;
            }),
          requireRunning: () => Effect.succeed(server),
        };

        return getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.sync(() => {
                      spawned = true;
                      return spawnedProcess();
                    }),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
          Effect.map((report) => ({ report, spawned })),
        );
      };

      const fromStopped = yield* runCase(stopped(stoppedServer.paths));
      const fromStale = yield* runCase(staleCleaned(staleServer.paths));

      expect(fromStopped.report._tag).toBe("Started");
      expect(fromStopped.spawned).toBe(true);
      expect(renderRestart(fromStopped.report)).toContain("previous state: no-manifest");
      expect(fromStale.report._tag).toBe("Started");
      expect(fromStale.spawned).toBe(true);
      expect(renderRestart(fromStale.report)).toContain("previous state: stale-manifest-removed");
    }),
  );

  it.effect("refuses invalid or wrong-scope manifests without shutdown or spawn", () =>
    Effect.gen(function* () {
      const invalidServer = runningServer("/tmp/xmux-restart-invalid.sock");
      const wrongServer = runningServer("/tmp/xmux-restart-wrong.sock");

      const runCase = (initial: CliInvalidManifest | CliWrongScopeServer) => {
        let shutdownCalled = false;
        let spawned = false;
        const discovery: ControlDiscoveryService = {
          resolvePaths: () => Effect.succeed(initial.paths),
          readManifest: () => Effect.die("readManifest should not be called"),
          discover: () => Effect.succeed(initial),
          requireRunning: () => Effect.die("requireRunning should not be called"),
        };
        const client: ControlClientService = {
          ...makeClient({}),
          shutdown: () =>
            Effect.sync(() => {
              shutdownCalled = true;
              return acceptedShutdown;
            }),
        };

        return Effect.exit(
          getRestartReport({ configPath: Option.some(initial.paths.configPath) }).pipe(
            Effect.provide(
              Layer.mergeAll(
                discoveryLayer(discovery),
                clientLayer(client),
                spawnerLayer(
                  makeSpawner({
                    spawn: () =>
                      Effect.sync(() => {
                        spawned = true;
                        return spawnedProcess();
                      }),
                  }),
                ),
                timingLayer({}),
                startLockLayer(),
              ),
            ),
          ),
        ).pipe(Effect.map((result) => ({ result, shutdownCalled, spawned })));
      };

      const invalid = yield* runCase(invalidManifest(invalidServer.paths));
      const wrong = yield* runCase(wrongScope(wrongServer.paths));

      expect(Exit.isFailure(invalid.result)).toBe(true);
      expect(Exit.isFailure(wrong.result)).toBe(true);
      expect(invalid.shutdownCalled).toBe(false);
      expect(wrong.shutdownCalled).toBe(false);
      expect(invalid.spawned).toBe(false);
      expect(wrong.spawned).toBe(false);
      if (Exit.isFailure(invalid.result)) {
        expect(Cause.squash(invalid.result.cause)).toHaveProperty("_tag", "CliLifecycleBlocked");
        expect(renderCliCause(invalid.result.cause, false)).toContain("manifest is invalid");
      }
      if (Exit.isFailure(wrong.result)) {
        expect(Cause.squash(wrong.result.cause)).toHaveProperty("_tag", "CliLifecycleBlocked");
        expect(renderCliCause(wrong.result.cause, false)).toContain("another scope");
      }
    }),
  );

  it.effect("returns CliSpawnError when replacement spawn fails", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-restart-spawn-failure.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.fail(
                      new CliSpawnError({
                        message: "spawn failed",
                        command: "/usr/bin/xmux",
                      }),
                    ),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(CliSpawnError);
      }
    }),
  );

  it.effect("reports early replacement server exit before restart readiness timeout", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-restart-early-exit.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.succeed(
                      spawnedProcess(Effect.succeed({ exitCode: null, signalCode: "SIGTERM" })),
                    ),
                }),
              ),
              timingLayer({ startTimeoutMs: 1_000 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliSpawnedServerExited);
        expect(failure).toHaveProperty("operation", "restart");
        expect(failure).toHaveProperty("signalCode", "SIGTERM");
        expect(renderCliCause(exit.cause, false)).toContain("signal SIGTERM");
        expect(renderCliCause(exit.cause, false)).toContain("xmux server run --foreground");
      }
    }),
  );

  it.live("returns restart readiness timeout with foreground retry guidance", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-restart-readiness-timeout.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(stopped(server.paths)),
        requireRunning: () => Effect.succeed(server),
      };

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some(server.paths.configPath) }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer(discovery),
              clientLayer(makeClient({})),
              spawnerLayer(makeSpawner({})),
              timingLayer({ startTimeoutMs: 1 }),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toHaveProperty("_tag", "CliWaitTimeout");
        expect(failure).toHaveProperty("operation", "restart");
        expect(renderCliCause(exit.cause, false)).toContain("Retry in the foreground");
      }
    }),
  );
});

describe("lifecycle input parsing", () => {
  it.effect("start fails invalid --config before discovery, spawn, or client calls", () =>
    Effect.gen(function* () {
      let discoveryCalled = false;
      let clientCalled = false;
      let spawnCalled = false;
      const discoveryFailure = Effect.sync(() => {
        discoveryCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("discovery should not be called")));
      const clientFailure = Effect.sync(() => {
        clientCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("client should not be called")));

      const exit = yield* Effect.exit(
        getStartReport({ configPath: Option.some("") }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer({
                resolvePaths: () => discoveryFailure,
                readManifest: () => discoveryFailure,
                discover: () => discoveryFailure,
                requireRunning: () => discoveryFailure,
              }),
              clientLayer({
                health: () => clientFailure,
                status: () => clientFailure,
                logs: () => clientFailure,
                shutdown: () => clientFailure,
              }),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.sync(() => {
                      spawnCalled = true;
                      return spawnedProcess();
                    }),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(CliInvalidInput);
      }
      expect(discoveryCalled).toBe(false);
      expect(clientCalled).toBe(false);
      expect(spawnCalled).toBe(false);
    }),
  );

  it.effect("stop fails invalid --config before discovery or client calls", () =>
    Effect.gen(function* () {
      let discoveryCalled = false;
      let clientCalled = false;
      const discoveryFailure = Effect.sync(() => {
        discoveryCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("discovery should not be called")));
      const clientFailure = Effect.sync(() => {
        clientCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("client should not be called")));

      const exit = yield* Effect.exit(
        getStopReport({ configPath: Option.some("") }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer({
                resolvePaths: () => discoveryFailure,
                readManifest: () => discoveryFailure,
                discover: () => discoveryFailure,
                requireRunning: () => discoveryFailure,
              }),
              clientLayer({
                health: () => clientFailure,
                status: () => clientFailure,
                logs: () => clientFailure,
                shutdown: () => clientFailure,
              }),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(CliInvalidInput);
      }
      expect(discoveryCalled).toBe(false);
      expect(clientCalled).toBe(false);
    }),
  );

  it.effect("restart fails invalid --config before discovery, spawn, or client calls", () =>
    Effect.gen(function* () {
      let discoveryCalled = false;
      let clientCalled = false;
      let spawnCalled = false;
      const discoveryFailure = Effect.sync(() => {
        discoveryCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("discovery should not be called")));
      const clientFailure = Effect.sync(() => {
        clientCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("client should not be called")));

      const exit = yield* Effect.exit(
        getRestartReport({ configPath: Option.some("") }).pipe(
          Effect.provide(
            Layer.mergeAll(
              discoveryLayer({
                resolvePaths: () => discoveryFailure,
                readManifest: () => discoveryFailure,
                discover: () => discoveryFailure,
                requireRunning: () => discoveryFailure,
              }),
              clientLayer({
                health: () => clientFailure,
                status: () => clientFailure,
                logs: () => clientFailure,
                shutdown: () => clientFailure,
              }),
              spawnerLayer(
                makeSpawner({
                  spawn: () =>
                    Effect.sync(() => {
                      spawnCalled = true;
                      return spawnedProcess();
                    }),
                }),
              ),
              timingLayer({}),
              startLockLayer(),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(CliInvalidInput);
      }
      expect(discoveryCalled).toBe(false);
      expect(clientCalled).toBe(false);
      expect(spawnCalled).toBe(false);
    }),
  );
});
