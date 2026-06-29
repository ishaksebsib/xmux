import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it, layer } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect";
import { ConfigValidateResponse } from "../src/api/groups/config/schemas";
import { ServerBootConfig } from "../src/config/boot";
import { loadServerConfigFile } from "../src/config/load-jsonc";
import { loadEffectiveServerConfig, validateServerConfig } from "../src/config/normalize";
import { redactServerConfig } from "../src/config/redact";
import {
  ConfigValidationResult,
  EnvSecretRef,
  InlineSecretRef,
  RedactedSecretRef,
  RedactedServerConfig,
  ServerFileConfig,
} from "../src/contracts/config";
import { configPathFromString } from "../src/contracts/primitives";
import { ConfigParseError, ConfigSecretError, ConfigValidationError } from "../src/errors";
import type { HostRuntime } from "../src/platform/host";
import { nodeHostRuntimeLayer } from "../src/platform/node";
import { makeSecretResolverLayer } from "./support/secrets";

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeHostRuntimeLayer);
const secretLayer = makeSecretResolverLayer(
  new Map([
    ["TELEGRAM_BOT_TOKEN", "telegram-secret"],
    ["DISCORD_BOT_TOKEN", "discord-secret"],
  ]),
);
const configTestLayer = Layer.mergeAll(nodeFsPathLayer, secretLayer);

const decodeFileConfig = Schema.decodeUnknownSync(ServerFileConfig);
const decodeRedactedConfig = Schema.decodeUnknownSync(RedactedServerConfig);
const decodeValidateResponse = Schema.decodeUnknownSync(ConfigValidationResult);
const decodeApiValidateResponse = Schema.decodeUnknownSync(ConfigValidateResponse);
const decodeRedactedSecret = Schema.decodeUnknownSync(RedactedSecretRef);

const withTempConfigPath = <A, E, R>(
  name: string,
  use: (
    path: ReturnType<typeof configPathFromString>,
    root: string,
  ) => Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path | HostRuntime>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-config-" });
    return yield* use(configPathFromString(pathService.join(root, name)), root);
  });

describe("ServerFileConfig schema", () => {
  it.effect("decodes minimal and full product config shapes", () =>
    Effect.sync(() => {
      const minimal = decodeFileConfig({});
      assert.instanceOf(minimal, ServerFileConfig);

      const full = decodeFileConfig({
        xmux: {
          workspace: { defaultDir: "~/dev" },
          responses: {
            thinking: { hide: false, maxChars: 320 },
            tools: {
              hide: false,
              maxInputStringChars: 50,
              maxInputObjectEntries: 2,
              maxTextOutputChars: 280,
              maxJsonOutputChars: 400,
            },
          },
          commands: {
            resume: { maxSessionsPerHarness: 5 },
            model: { maxModelsPerProvider: 10 },
            ls: { showHidden: false, maxEntries: 100 },
          },
          attachments: {
            enabled: true,
            maxBytes: 10_485_760,
            kinds: ["image", "audio", "document"],
          },
        },
        server: {
          logs: {
            level: "debug",
            rotation: { maxBytes: 10_485_760, maxFiles: 5 },
          },
        },
        stt: {
          enabled: true,
          provider: "openai-compatible",
          apiKey: { env: "OPENAI_API_KEY" },
          model: "gpt-4o-mini-transcribe",
          language: "en",
          maxBytes: 26_214_400,
        },
        chats: {
          telegram: {
            enabled: true,
            token: { env: "TELEGRAM_BOT_TOKEN" },
            access: { type: "allow-list", users: ["123456789"] },
          },
          discord: {
            enabled: true,
            token: { value: "discord-inline" },
            applicationId: "app-id",
            guildId: "guild-id",
            access: { type: "anyone" },
          },
          slack: {
            enabled: true,
            botToken: { value: "xoxb-token" },
            appToken: { value: "xapp-token" },
            access: { type: "allow-list", users: ["U123456789"] },
          },
        },
        harnesses: {
          opencode: { enabled: true, runtime: { type: "embedded" } },
          pi: { enabled: true, agentDir: "./pi-agent" },
        },
      });

      const telegram = full.chats?.telegram;
      const discord = full.chats?.discord;

      assert.strictEqual(full.xmux?.workspace?.defaultDir, "~/dev");
      assert.isDefined(telegram);
      assert.isDefined(discord);
      if (telegram === undefined || discord === undefined) return;
      assert.isTrue(telegram.enabled);
      assert.isTrue(discord.enabled);
      if (!telegram.enabled || !discord.enabled) return;
      assert.instanceOf(telegram.token, EnvSecretRef);
      assert.instanceOf(discord.token, InlineSecretRef);
    }),
  );

  it.effect("rejects adapter and feature sections without explicit enabled flags", () =>
    Effect.sync(() => {
      assert.throws(() => decodeFileConfig({ stt: { model: "gpt-4o-mini-transcribe" } }));
      assert.throws(() => decodeFileConfig({ chats: { telegram: { token: { value: "token" } } } }));
      assert.throws(() => decodeFileConfig({ harnesses: { pi: {} } }));
    }),
  );

  it.effect("rejects invalid log levels", () =>
    Effect.sync(() => {
      assert.throws(() => decodeFileConfig({ server: { logs: { level: "verbose" } } }));
    }),
  );
});

describe("invalid-state schemas", () => {
  it.effect("rejects invalid config validate API responses", () =>
    Effect.sync(() => {
      assert.throws(() =>
        decodeApiValidateResponse({
          version: "v1",
          configPath: "/tmp/xmux/config.jsonc",
          valid: true,
          issues: [],
        }),
      );
      assert.throws(() =>
        decodeApiValidateResponse({
          version: "v1",
          configPath: "/tmp/xmux/config.jsonc",
          valid: false,
          issues: [],
        }),
      );
    }),
  );

  it.effect("rejects invalid redacted secret variants", () =>
    Effect.sync(() => {
      assert.throws(() => decodeRedactedSecret({ source: "env", redacted: true }));
    }),
  );
});

describe("ServerBootConfig", () => {
  it.effect("loads XDG paths from an Effect ConfigProvider", () =>
    Effect.gen(function* () {
      const boot = yield* ServerBootConfig;
      assert.deepStrictEqual(Option.getOrUndefined(boot.xdgConfigHome), "/tmp/xmux-config");
      assert.deepStrictEqual(Option.getOrUndefined(boot.xdgStateHome), "/tmp/xmux-state");
      assert.deepStrictEqual(Option.getOrUndefined(boot.xdgRuntimeDir), "/tmp/xmux-runtime");
    }).pipe(
      Effect.provide(
        ServerBootConfig.layer.pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                XDG_CONFIG_HOME: "/tmp/xmux-config",
                XDG_STATE_HOME: "/tmp/xmux-state",
                XDG_RUNTIME_DIR: "/tmp/xmux-runtime",
              }),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("defaults missing XDG paths to none and fails invalid paths", () =>
    Effect.gen(function* () {
      const defaults = yield* ServerBootConfig.pipe(
        Effect.provide(
          ServerBootConfig.layer.pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
          ),
        ),
      );
      assert.isTrue(Option.isNone(defaults.xdgConfigHome));

      const invalid = yield* ServerBootConfig.pipe(
        Effect.provide(
          ServerBootConfig.layer.pipe(
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromUnknown({ XDG_CONFIG_HOME: "relative" })),
            ),
          ),
        ),
        Effect.flip,
      );
      assert.strictEqual(invalid._tag, "BootConfigError");
    }),
  );
});

describe("config loading and validation", () => {
  layer(configTestLayer)((it) => {
    it.effect("loads JSONC with comments and trailing commas", () =>
      withTempConfigPath("xmux.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            configPath,
            `{
  // comments are accepted
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "server": { "logs": { "level": "info" } },
}`,
          );

          const config = yield* loadServerConfigFile(configPath);
          assert.strictEqual(config?.xmux?.workspace?.defaultDir, "./workspace");
        }),
      ),
    );

    it.effect("fails invalid JSONC with ConfigParseError", () =>
      withTempConfigPath("bad.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(configPath, "{ invalid json }");

          const result = yield* loadServerConfigFile(configPath).pipe(
            Effect.catchTag("ConfigParseError", (error) => Effect.succeed(error)),
          );
          assert.instanceOf(result, ConfigParseError);
          assert.include(result.message, "offset");
        }),
      ),
    );

    it.effect("fails schema mismatches with ConfigValidationError", () =>
      withTempConfigPath("invalid.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(configPath, `{ "server": { "logs": { "level": "verbose" } } }`);

          const result = yield* loadServerConfigFile(configPath).pipe(
            Effect.catchTag("ConfigValidationError", (error) => Effect.succeed(error)),
          );
          assert.instanceOf(result, ConfigValidationError);
        }),
      ),
    );

    it.effect("resolves env and inline secrets without exposing secret values", () =>
      withTempConfigPath("secrets.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            configPath,
            `{
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "env": "TELEGRAM_BOT_TOKEN" },
      "access": { "type": "allow-list", "users": ["123456789"] }
    },
    "discord": {
      "enabled": true,
      "token": { "value": "discord-inline" },
      "applicationId": "app-id",
      "guildId": "guild-id",
      "access": { "type": "anyone" }
    }
  }
}`,
          );

          const effective = yield* loadEffectiveServerConfig(configPath);
          const telegram = effective.chats.telegram;
          const discord = effective.chats.discord;
          assert.isDefined(telegram);
          assert.isDefined(discord);
          if (telegram === undefined || discord === undefined) return;
          assert.isTrue(telegram.enabled);
          assert.isTrue(discord.enabled);
          if (!telegram.enabled || !discord.enabled) return;

          assert.strictEqual(Redacted.value(telegram.token.value), "telegram-secret");
          assert.strictEqual(Redacted.value(discord.token.value), "discord-inline");

          const redacted = redactServerConfig(effective);
          const decoded = decodeRedactedConfig(redacted);
          const redactedTelegram = decoded.chats.telegram;
          const redactedDiscord = decoded.chats.discord;
          assert.isDefined(redactedTelegram);
          assert.isDefined(redactedDiscord);
          if (redactedTelegram === undefined || redactedDiscord === undefined) return;
          assert.isTrue(redactedTelegram.enabled);
          assert.isTrue(redactedDiscord.enabled);
          if (!redactedTelegram.enabled || !redactedDiscord.enabled) return;

          assert.isTrue(redactedTelegram.token.redacted);
          assert.strictEqual(
            redactedTelegram.token.source === "env" ? redactedTelegram.token.env : undefined,
            "TELEGRAM_BOT_TOKEN",
          );
          assert.strictEqual(redactedDiscord.token.source, "value");
          assert.notInclude(JSON.stringify(decoded), "telegram-secret");
          assert.notInclude(JSON.stringify(decoded), "discord-inline");
        }),
      ),
    );

    it.effect("fails configured chats without explicit access", () =>
      withTempConfigPath("missing-access.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            configPath,
            `{
  "chats": {
    "telegram": { "enabled": true, "token": { "env": "TELEGRAM_BOT_TOKEN" } }
  }
}`,
          );

          const result = yield* loadEffectiveServerConfig(configPath).pipe(
            Effect.catchTag("ConfigValidationError", (error) => Effect.succeed(error)),
          );
          assert.instanceOf(result, ConfigValidationError);
          assert.include(result.message, `["chats"]["telegram"]["access"]`);
        }),
      ),
    );

    it.effect("fails missing env secrets with ConfigSecretError", () =>
      withTempConfigPath("missing-secret.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            configPath,
            `{
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "env": "MISSING_TOKEN" },
      "access": { "type": "anyone" }
    }
  }
}`,
          );

          const result = yield* loadEffectiveServerConfig(configPath).pipe(
            Effect.catchTag("ConfigSecretError", (error) => Effect.succeed(error)),
          );
          assert.instanceOf(result, ConfigSecretError);
          assert.strictEqual(result.env, "MISSING_TOKEN");
          assert.notInclude(result.message, "telegram-secret");
        }),
      ),
    );

    it.effect(
      "parses disabled integrations without resolving secrets or requiring runtime fields",
      () =>
        withTempConfigPath("disabled.jsonc", (configPath) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            yield* fs.writeFileString(
              configPath,
              `{
  "stt": { "enabled": false, "apiKey": { "env": "MISSING_TOKEN" } },
  "chats": {
    "telegram": { "enabled": false, "token": { "env": "MISSING_TOKEN" } }
  },
  "harnesses": {
    "pi": { "enabled": false }
  }
}`,
            );

            const effective = yield* loadEffectiveServerConfig(configPath);
            assert.strictEqual(effective.stt?.enabled, false);
            assert.strictEqual(effective.chats.telegram?.enabled, false);
            assert.strictEqual(effective.harnesses.pi?.enabled, false);

            const redacted = decodeRedactedConfig(redactServerConfig(effective));
            assert.strictEqual(redacted.stt?.enabled, false);
            assert.strictEqual(redacted.chats.telegram?.enabled, false);
            assert.strictEqual(redacted.harnesses.pi?.enabled, false);
          }),
        ),
    );

    it.effect("returns schema-valid validation responses", () =>
      withTempConfigPath("validate.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(configPath, `{ "server": { "logs": { "level": "verbose" } } }`);

          const response = yield* validateServerConfig(configPath);
          const decoded = decodeValidateResponse(response);
          assert.isFalse(decoded.valid);
          assert.strictEqual(decoded.issues[0]?.code, "ConfigValidationError");
        }),
      ),
    );
  });
});
