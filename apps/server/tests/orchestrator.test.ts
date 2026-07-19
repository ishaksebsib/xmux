import { access } from "node:fs/promises";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it, layer } from "@effect/vitest";
import {
  Result,
  XmuxInitializeError,
  createInMemoryStore,
  dummyXmuxLogger,
  type ThreadWorkspace,
  XmuxCloseError,
} from "@xmux/orchestrator";
import { createSqliteStore } from "@xmux/store-sqlite";
import { Effect, Fiber, Layer, Ref } from "effect";
import { makeTestOrchestratorFactoryLayer } from "./support/orchestrator";
import { makeSecretResolverLayer } from "./support/secrets";
import { validTelegramConfig } from "./support/config";
import { makeSandbox } from "./support/sandbox";
import { loadEffectiveServerConfig } from "../src/config/normalize";
import {
  isoTimestampFromString,
  processIdFromNumber,
  sessionIdFromString,
} from "../src/contracts/primitives";
import { ServerConfig } from "../src/config/service";
import { OrchestratorStore } from "../src/db/orchestrator-store";
import { LogReader } from "../src/logging/log-reader";
import { decideOrchestratorActivation } from "../src/orchestrator/activation";
import { mapEffectiveConfigToXmuxConfig } from "../src/orchestrator/config-map";
import { safeStatusReasonFromString } from "../src/orchestrator/status-model";
import { OrchestratorFactory, type OrchestratorRuntime } from "../src/orchestrator/factory";
import { makeServerOrchestratorMiddleware } from "../src/orchestrator/middleware";
import { OrchestratorStatusRegistry } from "../src/orchestrator/status-registry";
import { nodeOrchestratorFactoryLayer, nodeHostRuntimeLayer } from "../src/platform/node";
import type { ServerRuntimePaths } from "../src/server-control/paths";
import { RuntimePaths } from "../src/server-control/paths";
import { startOrchestrator } from "../src/orchestrator/runtime";
import { ControlTransport, ServerProbe } from "../src/server-control/ports";
import { ServerIdentity } from "../src/server-runtime/identity";
import { ShutdownCoordinator } from "../src/server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../src/server-runtime/state";
import { serverMain } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const configTestLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  nodeHostRuntimeLayer,
  makeSecretResolverLayer(
    new Map([
      ["OPENAI_API_KEY", "openai-secret"],
      ["TELEGRAM_BOT_TOKEN", "telegram-secret"],
      ["SLACK_BOT_TOKEN", "xoxb-slack-secret"],
      ["SLACK_APP_TOKEN", "xapp-slack-secret"],
    ]),
  ),
);
const serverProbeUnreachableLayer = Layer.succeed(ServerProbe)({
  isAlive: () => Effect.succeed(false),
});

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

const okRuntime = (
  input: {
    readonly status?: OrchestratorRuntime["status"];
    readonly initialize?: OrchestratorRuntime["initialize"];
    readonly shutdown?: OrchestratorRuntime["shutdown"];
  } = {},
): OrchestratorRuntime => ({
  status:
    input.status ??
    (() => ({
      chats: { lifecycle: "started", adapters: [{ id: "telegram", state: "active" }] },
      harnesses: { adapters: [{ id: "opencode", state: "configured_lazy" }] },
    })),
  initialize:
    input.initialize ?? (() => Promise.resolve(Result.ok<void, XmuxInitializeError>(undefined))),
  shutdown: input.shutdown ?? (() => Promise.resolve(Result.ok<void, XmuxCloseError>(undefined))),
});

const loadConfig = (content: string) =>
  Effect.gen(function* () {
    const sandbox = yield* makeSandbox;
    yield* sandbox.writeConfig(content);
    return yield* loadEffectiveServerConfig(sandbox.paths.configPath);
  });

interface TestControlTransport {
  readonly bind: () => Effect.Effect<void>;
}

const makeServerLayer = (input: {
  readonly paths: ServerRuntimePaths;
  readonly transport: TestControlTransport;
  readonly factoryLayer?: Layer.Layer<OrchestratorFactory>;
}) => {
  const base = Layer.mergeAll(
    nodeHostRuntimeLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    makeSecretResolverLayer(new Map()),
    input.factoryLayer ?? makeTestOrchestratorFactoryLayer(),
    serverProbeUnreachableLayer,
    Layer.succeed(RuntimePaths)(input.paths),
    Layer.succeed(ServerIdentity)({
      pid: processIdFromNumber(process.pid),
      startedAt: fixedStartedAt,
      startedAtIso: isoTimestampFromString(fixedStartedAt.toISOString()),
      sessionId: sessionIdFromString("orchestrator-test"),
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfig.layer, base);
  const withLogReader = Layer.provideMerge(LogReader.layer, withConfig);

  return Layer.mergeAll(
    withLogReader,
    StatusRegistry.layer,
    OrchestratorStatusRegistry.layer,
    ShutdownCoordinator.layer,
    Layer.succeed(ControlTransport)(input.transport),
  );
};

const fullEnabledConfig = `{
  "xmux": {
    "workspace": { "defaultDir": "./workspace" },
    "responses": {
      "thinking": { "hide": true, "maxChars": 640 },
      "tools": {
        "hide": true,
        "maxInputStringChars": 80,
        "maxInputObjectEntries": 4,
        "maxTextOutputChars": 1200,
        "maxJsonOutputChars": 2400
      }
    },
    "commands": {
      "resume": { "maxSessionsPerHarness": 8 },
      "model": { "maxModelsPerProvider": 20 },
      "ls": { "showHidden": true, "maxEntries": 250 }
    },
    "attachments": { "enabled": false, "maxBytes": 12345, "kinds": ["image", "document"] }
  },
  "stt": {
    "enabled": true,
    "apiKey": { "env": "OPENAI_API_KEY" },
    "baseUrl": "https://api.openai.example/v1",
    "endpointPath": "/audio/transcriptions",
    "model": "gpt-4o-mini-transcribe",
    "language": "en",
    "maxBytes": 22222,
    "timeoutMs": 30000
  },
  "chats": {
    "telegram": { "enabled": true, "token": { "env": "TELEGRAM_BOT_TOKEN" }, "access": { "type": "anyone" } },
    "slack": {
      "enabled": true,
      "botToken": { "env": "SLACK_BOT_TOKEN" },
      "appToken": { "env": "SLACK_APP_TOKEN" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": {
    "opencode": { "enabled": true, "runtime": { "type": "embedded" }, "defaultThinking": "high" },
    "pi": { "enabled": true, "agentDir": "./.pi-agent", "defaultModel": { "modelId": "gpt-5-mini" } }
  }
}`;

describe("orchestrator activation and config", () => {
  layer(configTestLayer)((it) => {
    it.effect("models disabled, invalid, and enabled activation states explicitly", () =>
      Effect.gen(function* () {
        const disabled = decideOrchestratorActivation(
          yield* loadConfig(`{ "xmux": { "workspace": { "defaultDir": "./workspace" } } }`),
        );
        const harnessOnly = decideOrchestratorActivation(
          yield* loadConfig(`{
  "harnesses": { "opencode": { "enabled": true, "runtime": { "type": "embedded" } } }
}`),
        );
        const explicitlyDisabled = decideOrchestratorActivation(
          yield* loadConfig(`{
  "chats": { "telegram": { "enabled": false, "token": { "env": "MISSING_TOKEN" } } },
  "harnesses": { "pi": { "enabled": false } }
}`),
        );
        const invalid = decideOrchestratorActivation(
          yield* loadConfig(`{
  "chats": { "telegram": { "enabled": true, "token": { "env": "TELEGRAM_BOT_TOKEN" }, "access": { "type": "anyone" } } }
}`),
        );
        const enabled = decideOrchestratorActivation(yield* loadConfig(fullEnabledConfig));

        assert.strictEqual(disabled._tag, "Disabled");
        assert.deepStrictEqual(disabled.chats, []);
        assert.strictEqual(harnessOnly._tag, "Disabled");
        assert.deepStrictEqual(harnessOnly.harnesses, ["opencode"]);
        assert.strictEqual(explicitlyDisabled._tag, "Disabled");
        assert.deepStrictEqual(explicitlyDisabled.chats, []);
        assert.deepStrictEqual(explicitlyDisabled.harnesses, []);
        assert.strictEqual(invalid._tag, "Invalid");
        assert.deepStrictEqual(invalid.chats, ["telegram"]);
        assert.strictEqual(enabled._tag, "Enabled");
        assert.deepStrictEqual(enabled.chats, ["telegram", "slack"]);
        assert.deepStrictEqual(enabled.harnesses, ["opencode", "pi"]);
      }),
    );

    it.effect("maps normalized server config to orchestrator config without raw file inputs", () =>
      Effect.gen(function* () {
        const effective = yield* loadConfig(fullEnabledConfig);
        const mapped = mapEffectiveConfigToXmuxConfig(effective);

        assert.strictEqual(mapped.defaultWorkingDirectory, effective.xmux.workspace.defaultDir);
        assert.strictEqual(mapped.deliveryMode, "requester_only");
        assert.deepStrictEqual(mapped.workspace, { showHiddenFiles: true, maxListEntries: 250 });
        assert.deepStrictEqual(mapped.resume, { maxSessionsPerHarness: 8 });
        assert.deepStrictEqual(mapped.model, { maxModelsPerProvider: 20 });
        assert.strictEqual(mapped.prompt?.response?.showToolOutput, false);
        assert.strictEqual(mapped.prompt?.response?.showReasoning, false);
        assert.strictEqual(mapped.prompt?.response?.maxReasoningChars, 640);
        assert.strictEqual(mapped.prompt?.response?.maxToolInputStringChars, 80);
        assert.strictEqual(mapped.prompt?.response?.maxToolInputObjectEntries, 4);
        assert.strictEqual(mapped.prompt?.response?.maxToolTextOutputChars, 1200);
        assert.strictEqual(mapped.prompt?.response?.maxToolJsonOutputChars, 2400);
        assert.deepStrictEqual(mapped.prompt?.attachments, {
          enabled: false,
          maxBytes: 12345,
          kinds: ["image", "document"],
        });
        assert.strictEqual(mapped.stt?.enabled, true);
        assert.strictEqual(mapped.stt?.apiKey, "openai-secret");
        assert.strictEqual(mapped.stt?.model, "gpt-4o-mini-transcribe");
        assert.strictEqual(mapped.stt?.language, "en");
      }),
    );

    it.effect(
      "node factory constructs a runtime structurally without opening network adapters",
      () =>
        Effect.gen(function* () {
          const effective = yield* loadConfig(fullEnabledConfig);
          const factory = yield* OrchestratorFactory;
          const runtime = yield* factory.create({
            effectiveConfig: effective,
            config: mapEffectiveConfigToXmuxConfig(effective),
            store: createInMemoryStore(),
            logger: dummyXmuxLogger,
            middleware: makeServerOrchestratorMiddleware(effective),
          });

          assert.strictEqual(typeof runtime.initialize, "function");
          assert.strictEqual(typeof runtime.shutdown, "function");
        }).pipe(Effect.provide(nodeOrchestratorFactoryLayer)),
    );
  });
});

describe("orchestrator server lifecycle", () => {
  it.effect("does not construct the orchestrator when activation is disabled", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(`{
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "harnesses": { "opencode": { "enabled": true, "runtime": { "type": "embedded" } } }
}`);
      const createCalls = yield* Ref.make(0);
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        create: () => Ref.update(createCalls, (value) => value + 1).pipe(Effect.as(okRuntime())),
      });
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Effect.void },
        factoryLayer,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
          const shutdown = yield* ShutdownCoordinator;
          yield* shutdown.completeShutdown();
          yield* Fiber.join(fiber);
        }).pipe(Effect.provide(layer)),
      );

      assert.strictEqual(yield* Ref.get(createCalls), 0);
    }),
  );

  it.effect("starts exactly once when enabled and releases on shutdown", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      let createCalls = 0;
      let initializeCalls = 0;
      let shutdownCalls = 0;
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        create: (input) =>
          Effect.sync(() => {
            assert.strictEqual(typeof input.logger.info, "function");
            assert.ok(input.middleware.length >= 2);
            createCalls += 1;
            return okRuntime({
              initialize: () => {
                initializeCalls += 1;
                return Promise.resolve(Result.ok<void, XmuxInitializeError>(undefined));
              },
              shutdown: () => {
                shutdownCalls += 1;
                return Promise.resolve(Result.ok<void, XmuxCloseError>(undefined));
              },
            });
          }),
      });
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Effect.void },
        factoryLayer,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
          const shutdown = yield* ShutdownCoordinator;
          yield* shutdown.completeShutdown();
          yield* Fiber.join(fiber);
        }).pipe(Effect.provide(layer)),
      );

      assert.strictEqual(createCalls, 1);
      assert.strictEqual(initializeCalls, 1);
      assert.strictEqual(shutdownCalls, 1);
    }),
  );

  it.effect("serves live runtime status after startup", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      let harnessState: "configured_lazy" | "opened" = "configured_lazy";
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        status: () => ({
          chats: { lifecycle: "started", adapters: [{ id: "telegram", state: "active" }] },
          harnesses: { adapters: [{ id: "opencode", state: harnessState }] },
        }),
      });
      const layer = Layer.mergeAll(
        makeServerLayer({
          paths: sandbox.paths,
          transport: { bind: () => Effect.void },
          factoryLayer,
        }),
        Layer.succeed(OrchestratorStore)(createInMemoryStore()),
      );

      const live = yield* Effect.scoped(
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const effective = yield* config.loadCurrent(sandbox.paths.configPath);
          yield* startOrchestrator(effective);
          const orchestratorStatus = yield* OrchestratorStatusRegistry;
          const before = yield* orchestratorStatus.get();
          harnessState = "opened";
          const after = yield* orchestratorStatus.get();
          return { before, after };
        }).pipe(Effect.provide(layer)),
      );

      assert.deepStrictEqual(
        live.before.harnesses.map((adapter) => ({ id: adapter.id, state: adapter.state })),
        [{ id: "opencode", state: "configured_lazy" }],
      );
      assert.deepStrictEqual(
        live.after.harnesses.map((adapter) => ({ id: adapter.id, state: adapter.state })),
        [{ id: "opencode", state: "opened" }],
      );
    }),
  );

  it.effect("captures degraded status when orchestrator initialization fails", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        status: () => ({
          chats: {
            lifecycle: "created",
            adapters: [{ id: "telegram", state: "failed", reason: "ChatAdapterOpenError" }],
          },
          harnesses: { adapters: [{ id: "opencode", state: "configured_lazy" }] },
        }),
        initialize: () =>
          Promise.resolve(
            Result.err<void, XmuxInitializeError>(
              new XmuxInitializeError({ cause: new Error("secret-token-should-not-leak") }),
            ),
          ),
      });
      const layer = Layer.mergeAll(
        makeServerLayer({
          paths: sandbox.paths,
          transport: { bind: () => Effect.void },
          factoryLayer,
        }),
        Layer.succeed(OrchestratorStore)(createInMemoryStore()),
      );

      const degraded = yield* Effect.scoped(
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const effective = yield* config.loadCurrent(sandbox.paths.configPath);
          yield* startOrchestrator(effective);
          const orchestratorStatus = yield* OrchestratorStatusRegistry;
          return yield* orchestratorStatus.get();
        }).pipe(Effect.provide(layer)),
      );

      assert.strictEqual(degraded.state, "failed");
      assert.deepStrictEqual(
        degraded.chats.map((adapter) => ({
          id: adapter.id,
          state: adapter.state,
          reason: adapter.reason,
        })),
        [
          {
            id: "telegram",
            state: "failed",
            reason: safeStatusReasonFromString("ChatAdapterOpenError"),
          },
        ],
      );
      assert.notInclude(JSON.stringify(degraded), "secret-token-should-not-leak");
    }),
  );

  it.effect("keeps non-adapter initialization failures fatal", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      const shutdownCalls = yield* Ref.make(0);
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        status: () => ({
          chats: { lifecycle: "created", adapters: [{ id: "telegram", state: "configured" }] },
          harnesses: { adapters: [{ id: "opencode", state: "configured_lazy" }] },
        }),
        initialize: () =>
          Promise.resolve(
            Result.err<void, XmuxInitializeError>(
              new XmuxInitializeError({ cause: new Error("secret-token-should-not-leak") }),
            ),
          ),
        shutdown: () =>
          Ref.update(shutdownCalls, (count) => count + 1).pipe(
            Effect.as(Result.ok<void, XmuxCloseError>(undefined)),
            Effect.runPromise,
          ),
      });
      const layer = Layer.mergeAll(
        makeServerLayer({
          paths: sandbox.paths,
          transport: { bind: () => Effect.void },
          factoryLayer,
        }),
        Layer.succeed(OrchestratorStore)(createInMemoryStore()),
      );

      const failed = yield* Effect.scoped(
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const effective = yield* config.loadCurrent(sandbox.paths.configPath);
          const error = yield* startOrchestrator(effective).pipe(Effect.flip);
          const orchestratorStatus = yield* OrchestratorStatusRegistry;
          const snapshot = yield* orchestratorStatus.get();
          assert.strictEqual(error._tag, "OrchestratorStartupError");
          return snapshot;
        }).pipe(Effect.provide(layer)),
      );

      assert.strictEqual(failed.state, "failed");
      assert.strictEqual(failed.reason, "OrchestratorStartupError");
      assert.strictEqual(yield* Ref.get(shutdownCalls), 1);
      assert.notInclude(JSON.stringify(failed), "secret-token-should-not-leak");
    }),
  );

  it.effect("fails startup for chats without harnesses and cleans up control state", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(`{
  "chats": { "telegram": { "enabled": true, "token": { "value": "inline-token" }, "access": { "type": "anyone" } } }
}`);
      const bindCalled = yield* Ref.make(false);
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Ref.set(bindCalled, true) },
      });

      const failed = yield* Effect.gen(function* () {
        const error = yield* Effect.scoped(serverMain()).pipe(Effect.flip);
        const registry = yield* OrchestratorStatusRegistry;
        const snapshot = yield* registry.get();
        assert.strictEqual(error._tag, "OrchestratorConfigurationError");
        return snapshot;
      }).pipe(Effect.provide(layer));

      assert.strictEqual(failed.state, "failed");
      assert.strictEqual(failed.reason, "ChatsWithoutHarnesses");
      assert.isTrue(yield* Ref.get(bindCalled));
      assert.isFalse(yield* exists(sandbox.paths.manifestPath));
      assert.isFalse(yield* exists(sandbox.paths.controlEndpoint.path));
    }),
  );

  it.effect("passes the DB-backed orchestrator store to the factory", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      const workspace = {
        thread: { chatId: "telegram", threadId: "thread-1" },
        cwd: "/repo",
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:00:00.000Z",
      } satisfies ThreadWorkspace;
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        create: (input) =>
          Effect.succeed(
            okRuntime({
              initialize: async () => {
                const initialized = await input.store.initialize();
                if (initialized.isErr()) {
                  return Result.err(new XmuxInitializeError({ cause: initialized.error }));
                }
                const stored = await input.store.workspaces.set(workspace);
                return stored.isErr()
                  ? Result.err(new XmuxInitializeError({ cause: stored.error }))
                  : Result.ok();
              },
              shutdown: async () => {
                const closed = await input.store.close();
                return closed.isErr()
                  ? Result.err(new XmuxCloseError({ store: closed.error }))
                  : Result.ok();
              },
            }),
          ),
      });
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Effect.void },
        factoryLayer,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
          const shutdown = yield* ShutdownCoordinator;
          yield* shutdown.completeShutdown();
          yield* Fiber.join(fiber);
        }).pipe(Effect.provide(layer)),
      );

      const reopened = createSqliteStore({ path: sandbox.paths.dbPath });
      assert.isTrue((yield* Effect.promise(() => reopened.initialize())).isOk());
      const persisted = yield* Effect.promise(() => reopened.workspaces.get(workspace.thread));
      assert.deepStrictEqual(persisted.unwrap("expected workspace lookup to succeed"), workspace);
      assert.isTrue((yield* Effect.promise(() => reopened.close())).isOk());
    }),
  );
});
