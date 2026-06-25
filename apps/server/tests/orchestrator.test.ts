import { access } from "node:fs/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import {
  Result,
  XmuxInitializeError,
  createInMemoryStore,
  type Store,
  type ThreadWorkspace,
  type XmuxCloseError,
} from "@xmux/orchestrator";
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
import { makeDatabaseSqlLayer } from "../src/db/layer";
import { makeSqliteOrchestratorStore } from "../src/db/orchestrator-store";
import { LogReader } from "../src/logging/log-reader";
import { decideOrchestratorActivation } from "../src/orchestrator/activation";
import { mapEffectiveConfigToXmuxConfig } from "../src/orchestrator/config-map";
import { OrchestratorConfigurationError } from "../src/orchestrator/errors";
import { OrchestratorFactory, type OrchestratorRuntime } from "../src/orchestrator/factory";
import { nodeOrchestratorFactoryLayer, nodeHostRuntimeLayer } from "../src/platform/node";
import type { ServerRuntimePaths } from "../src/server-control/paths";
import { RuntimePaths } from "../src/server-control/paths";
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
    readonly initialize?: OrchestratorRuntime["initialize"];
    readonly shutdown?: OrchestratorRuntime["shutdown"];
  } = {},
): OrchestratorRuntime => ({
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
    "apiKey": { "env": "OPENAI_API_KEY" },
    "baseUrl": "https://api.openai.example/v1",
    "endpointPath": "/audio/transcriptions",
    "model": "gpt-4o-mini-transcribe",
    "language": "en",
    "maxBytes": 22222,
    "timeoutMs": 30000
  },
  "chats": {
    "telegram": { "token": { "env": "TELEGRAM_BOT_TOKEN" }, "access": { "type": "anyone" } },
    "slack": {
      "botToken": { "env": "SLACK_BOT_TOKEN" },
      "appToken": { "env": "SLACK_APP_TOKEN" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": {
    "opencode": { "runtime": { "type": "embedded" }, "defaultThinking": "high" },
    "pi": { "agentDir": "./.pi-agent", "defaultModel": { "modelId": "gpt-5-mini" } }
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
  "harnesses": { "opencode": { "runtime": { "type": "embedded" } } }
}`),
        );
        const invalid = decideOrchestratorActivation(
          yield* loadConfig(`{
  "chats": { "telegram": { "token": { "env": "TELEGRAM_BOT_TOKEN" }, "access": { "type": "anyone" } } }
}`),
        );
        const enabled = decideOrchestratorActivation(yield* loadConfig(fullEnabledConfig));

        assert.strictEqual(disabled._tag, "Disabled");
        assert.deepStrictEqual(disabled.chats, []);
        assert.strictEqual(harnessOnly._tag, "Disabled");
        assert.deepStrictEqual(harnessOnly.harnesses, ["opencode"]);
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
      yield* sandbox.writeConfig(`{ "xmux": { "workspace": { "defaultDir": "./workspace" } } }`);
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
        create: () =>
          Effect.sync(() => {
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

  it.effect("startup failure cleans up transport and manifest before readiness", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(validTelegramConfig("inline-token"));
      const bindCalled = yield* Ref.make(false);
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        initialize: () =>
          Promise.resolve(
            Result.err<void, XmuxInitializeError>(new XmuxInitializeError({ cause: "boom" })),
          ),
      });
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Ref.set(bindCalled, true) },
        factoryLayer,
      });

      yield* Effect.gen(function* () {
        const error = yield* Effect.scoped(serverMain()).pipe(Effect.flip);
        const status = yield* StatusRegistry;

        assert.strictEqual(error._tag, "OrchestratorStartupError");
        assert.isTrue(yield* Ref.get(bindCalled));
        assert.isFalse(yield* exists(sandbox.paths.manifestPath));
        assert.isFalse(yield* exists(sandbox.paths.controlEndpoint.path));
        assert.strictEqual(yield* status.getState(), "starting");
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("fails startup for chats without harnesses and cleans up control state", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox;
      yield* sandbox.writeConfig(`{
  "chats": { "telegram": { "token": { "value": "inline-token" }, "access": { "type": "anyone" } } }
}`);
      const bindCalled = yield* Ref.make(false);
      const layer = makeServerLayer({
        paths: sandbox.paths,
        transport: { bind: () => Ref.set(bindCalled, true) },
      });

      const error = yield* Effect.scoped(serverMain()).pipe(Effect.provide(layer), Effect.flip);

      assert.strictEqual(error._tag, "OrchestratorConfigurationError");
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
          Effect.gen(function* () {
            const stored = yield* Effect.promise(() => input.store.workspaces.set(workspace));
            if (stored.isErr()) {
              return yield* OrchestratorConfigurationError.make({
                path: "store",
                reason: stored.error.message,
                message: "Factory could not write to orchestrator store.",
                cause: stored.error,
              });
            }
            return okRuntime();
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

      const persisted = yield* Effect.scoped(
        Effect.gen(function* () {
          const store: Store = yield* makeSqliteOrchestratorStore;
          return yield* Effect.promise(() => store.workspaces.get(workspace.thread));
        }).pipe(Effect.provide(makeDatabaseSqlLayer(sandbox.paths))),
      );

      assert.deepStrictEqual(persisted.unwrap("expected workspace lookup to succeed"), workspace);
    }),
  );
});
