import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  ConfigValidationResult,
  EnvSecretRef,
  InlineSecretRef,
  RedactedServerConfig,
  ServerFileConfig,
} from "../src/contracts/config";
import { ConfigParseError, ConfigSecretError, ConfigValidationError } from "../src/errors";
import { loadServerConfigFile } from "../src/config/load-jsonc";
import { redactServerConfig } from "../src/config/redact";
import { loadEffectiveServerConfig, validateServerConfig } from "../src/config/service";
import { makeSecretResolverLayer } from "../src/config/resolve-secrets";
import type { HostRuntime } from "../src/runtime/host";
import { NodeHostRuntime } from "../src/platform/node";

const NodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeHostRuntime);
const SecretLayer = makeSecretResolverLayer(
  new Map([
    ["TELEGRAM_BOT_TOKEN", "telegram-secret"],
    ["DISCORD_BOT_TOKEN", "discord-secret"],
  ]),
);
const ConfigTestLayer = Layer.mergeAll(NodeFsPathLayer, SecretLayer);

const decodeFileConfig = Schema.decodeUnknownSync(ServerFileConfig);
const decodeRedactedConfig = Schema.decodeUnknownSync(RedactedServerConfig);
const decodeValidateResponse = Schema.decodeUnknownSync(ConfigValidationResult);

const withTempConfigPath = <A, E, R>(
  name: string,
  use: (
    path: string,
    root: string,
  ) => Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path | HostRuntime>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-config-" });
    return yield* use(pathService.join(root, name), root);
  });

describe("ServerFileConfig schema", () => {
  it.effect("decodes minimal and full config shapes", () =>
    Effect.sync(() => {
      const minimal = decodeFileConfig({});
      assert.instanceOf(minimal, ServerFileConfig);

      const full = decodeFileConfig({
        userName: "Ishak",
        defaultWorkingDirectory: "~/dev",
        deliveryMode: "requester_only",
        server: { logLevel: "debug" },
        chats: {
          telegram: {
            enabled: true,
            token: { env: "TELEGRAM_BOT_TOKEN" },
            mode: { type: "polling" },
          },
          discord: {
            enabled: true,
            token: { value: "discord-inline" },
            applicationId: "app-id",
            guildId: "guild-id",
            mode: { type: "gateway" },
          },
        },
        harnesses: {
          opencode: { enabled: true, mode: "embedded" },
          pi: { enabled: true, agentDir: "./pi-agent", noTools: "builtin" },
        },
      });

      assert.strictEqual(full.userName, "Ishak");
      assert.instanceOf(full.chats?.telegram?.token, EnvSecretRef);
      assert.instanceOf(full.chats?.discord?.token, InlineSecretRef);
    }),
  );

  it.effect("rejects invalid delivery modes", () =>
    Effect.sync(() => {
      assert.throws(() => decodeFileConfig({ deliveryMode: "everyone" }));
    }),
  );
});

describe("config loading and validation", () => {
  layer(ConfigTestLayer)((it) => {
    it.effect("loads JSONC with comments and trailing commas", () =>
      withTempConfigPath("xmux.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            configPath,
            `{
  // comments are accepted
  "userName": "xmux",
  "defaultWorkingDirectory": "./workspace",
  "server": { "logLevel": "info" },
}`,
          );

          const config = yield* loadServerConfigFile(configPath);
          assert.strictEqual(config?.userName, "xmux");
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
          yield* fs.writeFileString(configPath, `{ "server": { "logLevel": "verbose" } }`);

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
      "token": { "env": "TELEGRAM_BOT_TOKEN" }
    },
    "discord": {
      "enabled": true,
      "token": { "value": "discord-inline" },
      "applicationId": "app-id"
    }
  }
}`,
          );

          const effective = yield* loadEffectiveServerConfig(configPath);
          assert.strictEqual(effective.chats.telegram.token?.value, "telegram-secret");
          assert.strictEqual(effective.chats.discord.token?.value, "discord-inline");

          const redacted = redactServerConfig(effective);
          const decoded = decodeRedactedConfig(redacted);
          assert.isTrue(decoded.chats.telegram.token?.redacted);
          assert.strictEqual(decoded.chats.telegram.token?.env, "TELEGRAM_BOT_TOKEN");
          assert.strictEqual(decoded.chats.discord.token?.source, "value");
          assert.notInclude(JSON.stringify(decoded), "telegram-secret");
          assert.notInclude(JSON.stringify(decoded), "discord-inline");
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
      "token": { "env": "MISSING_TOKEN" }
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

    it.effect("returns schema-valid validation responses", () =>
      withTempConfigPath("validate.jsonc", (configPath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(configPath, `{ "server": { "logLevel": "verbose" } }`);

          const response = yield* validateServerConfig(configPath);
          const decoded = decodeValidateResponse(response);
          assert.isFalse(decoded.valid);
          assert.strictEqual(decoded.issues[0]?.code, "ConfigValidationError");
        }),
      ),
    );
  });
});
