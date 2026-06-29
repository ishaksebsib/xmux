import { createServer, type RequestListener, type Server } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Option, Scope } from "effect";
import { ControlDiscovery } from "../../src/control/discovery";
import type { CliResolvedServerPaths } from "../../src/domain/discovery";
import type { JsonValue } from "../../src/output/format";
import { nodeControlDiscoveryLayer } from "../../src/platform/node/control-discovery";
import { parseServerTarget } from "../../src/domain/input";
import { writeText } from "./sandbox";

export const resolvePaths = (configPath: string): Effect.Effect<CliResolvedServerPaths, unknown> =>
  Effect.gen(function* () {
    const target = yield* parseServerTarget(Option.some(configPath));
    const discovery = yield* ControlDiscovery;
    return yield* discovery.resolvePaths(target);
  }).pipe(Effect.provide(nodeControlDiscoveryLayer));

export const discoverServer = (configPath: string) =>
  Effect.gen(function* () {
    const target = yield* parseServerTarget(Option.some(configPath));
    const discovery = yield* ControlDiscovery;
    return yield* discovery.discover(target);
  }).pipe(Effect.provide(nodeControlDiscoveryLayer));

export const requireRunningFailure = (configPath: string) =>
  Effect.gen(function* () {
    const target = yield* parseServerTarget(Option.some(configPath));
    const discovery = yield* ControlDiscovery;
    return yield* Effect.flip(discovery.requireRunning(target));
  }).pipe(Effect.provide(nodeControlDiscoveryLayer));

export const readManifest = (configPath: string) =>
  Effect.gen(function* () {
    const target = yield* parseServerTarget(Option.some(configPath));
    const discovery = yield* ControlDiscovery;
    return yield* discovery.readManifest(target);
  }).pipe(Effect.provide(nodeControlDiscoveryLayer));

export const writeServerManifest = (
  paths: CliResolvedServerPaths,
  options: { readonly pid?: number; readonly scopeId?: string; readonly sessionId?: string } = {},
): Effect.Effect<void> =>
  writeText(
    paths.manifestPath,
    JSON.stringify({
      version: 1,
      protocolVersion: 1,
      pid: options.pid ?? process.pid,
      sessionId: options.sessionId ?? "test-session",
      startedAt: "2026-06-16T00:00:00.000Z",
      configPath: paths.configPath,
      stateDir: paths.stateDir,
      scopeId: options.scopeId ?? paths.scopeId,
      endpoint: { kind: "unix-socket", path: paths.socketPath },
      owner: {
        client: "test",
        version: "0.0.0",
        executablePath: process.execPath,
      },
    }),
  );

const closeServer = (server: Server, socketPath: string): Effect.Effect<void> =>
  (server.listening
    ? Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
    : Effect.void
  ).pipe(
    Effect.flatMap(() => Effect.promise(() => rm(socketPath, { force: true }))),
    Effect.ignore,
  );

const bindUnixHttpServer = (
  socketPath: string,
  handler: RequestListener,
): Effect.Effect<Server, Error, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<Server, Error>((resume) => {
      const server = createServer(handler);

      const onError = (cause: Error): void => {
        server.off("listening", onListening);
        resume(Effect.fail(cause));
      };
      const onListening = (): void => {
        server.off("error", onError);
        resume(Effect.succeed(server));
      };

      server.once("error", onError);
      server.once("listening", onListening);
      void mkdir(dirname(socketPath), { recursive: true }).then(
        () => server.listen(socketPath),
        (cause: Error) => onError(cause),
      );

      return Effect.sync(() => {
        server.off("error", onError);
        server.off("listening", onListening);
      });
    }),
    (server) => closeServer(server, socketPath),
  );

export const bindHealthServer = (socketPath: string): Effect.Effect<Server, Error, Scope.Scope> =>
  bindUnixHttpServer(socketPath, (request, response) => {
    if (request.url !== "/healthz") {
      response.statusCode = 404;
      response.end();
      return;
    }

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
  });

export const bindShutdownServer = (
  paths: CliResolvedServerPaths,
  onShutdown?: () => void,
): Effect.Effect<Server, Error, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<Server, Error>((resume) => {
      const server = createServer((request, response) => {
        if (request.url === "/healthz") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
          return;
        }

        if (request.url === "/v1/status") {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              version: 1,
              protocolVersion: 1,
              pid: process.pid,
              startedAt: "2026-06-16T00:00:00.000Z",
              uptimeMs: 151_000,
              state: "ready",
              configPath: paths.configPath,
              stateDir: paths.stateDir,
              scopeId: paths.scopeId,
              endpoint: { kind: "unix-socket", path: paths.socketPath },
              orchestrator: {
                state: "running",
                activation: "enabled",
                chats: [{ id: "telegram", state: "active" }],
                harnesses: [{ id: "pi", state: "configured_lazy" }],
              },
            }),
          );
          return;
        }

        if (request.url === "/v1/shutdown" && request.method === "POST") {
          onShutdown?.();
          response.statusCode = 202;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ accepted: true, alreadyStopping: false }), () => {
            void closeServer(server, paths.socketPath).pipe(Effect.runPromise);
          });
          return;
        }

        response.statusCode = 404;
        response.end();
      });

      const onError = (cause: Error): void => {
        server.off("listening", onListening);
        resume(Effect.fail(cause));
      };
      const onListening = (): void => {
        server.off("error", onError);
        resume(Effect.succeed(server));
      };

      server.once("error", onError);
      server.once("listening", onListening);
      void mkdir(dirname(paths.socketPath), { recursive: true }).then(
        () => server.listen(paths.socketPath),
        (cause: Error) => onError(cause),
      );

      return Effect.sync(() => {
        server.off("error", onError);
        server.off("listening", onListening);
      });
    }),
    (server) => closeServer(server, paths.socketPath),
  );

export const bindStatusServer = (
  paths: CliResolvedServerPaths,
  orchestrator: JsonValue = {
    state: "running",
    activation: "enabled",
    chats: [{ id: "telegram", state: "active" }],
    harnesses: [{ id: "pi", state: "configured_lazy" }],
  },
  state = "ready",
): Effect.Effect<Server, Error, Scope.Scope> =>
  bindUnixHttpServer(paths.socketPath, (request, response) => {
    if (request.url === "/healthz") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
      return;
    }

    if (request.url === "/v1/status") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          version: 1,
          protocolVersion: 1,
          pid: process.pid,
          startedAt: "2026-06-16T00:00:00.000Z",
          uptimeMs: 151_000,
          state,
          configPath: paths.configPath,
          stateDir: paths.stateDir,
          scopeId: paths.scopeId,
          endpoint: { kind: "unix-socket", path: paths.socketPath },
          orchestrator,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end();
  });

export const bindLegacyStatusServer = (
  paths: CliResolvedServerPaths,
): Effect.Effect<Server, Error, Scope.Scope> =>
  bindUnixHttpServer(paths.socketPath, (request, response) => {
    if (request.url === "/healthz") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
      return;
    }

    if (request.url === "/v1/status") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          version: 1,
          protocolVersion: 1,
          pid: process.pid,
          startedAt: "2026-06-16T00:00:00.000Z",
          uptimeMs: 151_000,
          state: "ready",
          configPath: paths.configPath,
          stateDir: paths.stateDir,
          scopeId: paths.scopeId,
          endpoint: { kind: "unix-socket", path: paths.socketPath },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end();
  });

export type TestServerLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface TestServerLogEntry {
  readonly timestamp: string;
  readonly level: TestServerLogLevel;
  readonly message: JsonValue;
  readonly annotations?: Readonly<Record<string, JsonValue>>;
  readonly spans?: Readonly<Record<string, number>>;
  readonly cause?: string;
}

export const bindLogsServer = (
  paths: CliResolvedServerPaths,
  entries: ReadonlyArray<TestServerLogEntry>,
  onLogsRequest?: (url: string) => void,
): Effect.Effect<Server, Error, Scope.Scope> =>
  bindUnixHttpServer(paths.socketPath, (request, response) => {
    if (request.url === "/healthz") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
      return;
    }

    if (request.url?.startsWith("/v1/logs") === true) {
      onLogsRequest?.(request.url);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ version: 1, entries }));
      return;
    }

    response.statusCode = 404;
    response.end();
  });
