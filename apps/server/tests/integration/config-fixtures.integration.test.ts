import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigValidationResult, RedactedServerConfig } from "../../src/contracts/config";
import { configPathFromString } from "../../src/contracts/primitives";
import { ConfigValidationError } from "../../src/errors";
import { nodeHostRuntimeLayer } from "../../src/platform/node";
import { loadEffectiveServerConfig, validateServerConfig } from "../../src/config/normalize";
import { redactServerConfig } from "../../src/config/redact";
import { makeSecretResolverLayer } from "../support/secrets";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/config");
const fixturePath = (name: string) => configPathFromString(resolve(fixtureDir, name));

const configIntegrationLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  nodeHostRuntimeLayer,
  makeSecretResolverLayer(
    new Map([
      ["OPENAI_API_KEY", "openai-secret"],
      ["TELEGRAM_BOT_TOKEN", "telegram-secret"],
      ["SLACK_BOT_TOKEN", "slack-bot-secret"],
      ["SLACK_APP_TOKEN", "slack-app-secret"],
    ]),
  ),
);

const decodeRedactedConfig = Schema.decodeUnknownSync(RedactedServerConfig);
const decodeValidationResult = Schema.decodeUnknownSync(ConfigValidationResult);

describe("config fixture integration", () => {
  layer(configIntegrationLayer)((it) => {
    it.effect("loads a minimal real user config and applies defaults", () =>
      Effect.gen(function* () {
        const config = yield* loadEffectiveServerConfig(fixturePath("minimal.jsonc"));

        assert.strictEqual(config.server.logs.level, "info");
        assert.strictEqual(config.xmux.commands.resume.maxSessionsPerHarness, 5);
        assert.strictEqual(config.xmux.responses.thinking.maxChars, 320);
        assert.strictEqual(config.xmux.attachments.enabled, true);
        assert.deepStrictEqual(config.xmux.attachments.kinds, [
          "image",
          "audio",
          "video",
          "document",
          "archive",
          "other",
        ]);
        assert.match(config.xmux.workspace.defaultDir, /fixtures\/config\/workspace$/u);
      }),
    );

    it.effect("loads a full local config, resolves secrets, and redacts output", () =>
      Effect.gen(function* () {
        const config = yield* loadEffectiveServerConfig(fixturePath("full-local.jsonc"));

        assert.strictEqual(config.server.logs.level, "debug");
        assert.strictEqual(config.server.logs.rotation.maxFiles, 7);
        assert.strictEqual(config.xmux.responses.tools.maxJsonOutputChars, 2400);
        assert.deepStrictEqual(config.xmux.attachments.kinds, ["image", "document", "audio"]);

        assert.isDefined(config.stt);
        assert.isDefined(config.chats.telegram);
        assert.isDefined(config.chats.discord);
        assert.isDefined(config.chats.slack);
        assert.isDefined(config.harnesses.opencode);
        assert.isDefined(config.harnesses.pi);
        if (
          config.stt === undefined ||
          config.chats.telegram === undefined ||
          config.chats.discord === undefined ||
          config.chats.slack === undefined ||
          config.harnesses.opencode === undefined ||
          config.harnesses.pi === undefined
        ) {
          return;
        }

        assert.isDefined(config.stt.apiKey);
        if (config.stt.apiKey === undefined) return;
        assert.strictEqual(Redacted.value(config.stt.apiKey.value), "openai-secret");
        assert.strictEqual(Redacted.value(config.chats.telegram.token.value), "telegram-secret");
        assert.strictEqual(
          Redacted.value(config.chats.discord.token.value),
          "discord-inline-secret",
        );
        assert.strictEqual(Redacted.value(config.chats.slack.botToken.value), "slack-bot-secret");
        assert.strictEqual(Redacted.value(config.chats.slack.appToken.value), "slack-app-secret");

        assert.strictEqual(config.harnesses.opencode.runtime.type, "external");
        if (config.harnesses.opencode.runtime.type === "external") {
          assert.strictEqual(config.harnesses.opencode.runtime.baseUrl, "http://127.0.0.1:4096");
        }
        assert.strictEqual(config.harnesses.opencode.defaultModel?.providerId, "anthropic");
        assert.strictEqual(config.harnesses.pi.defaultModel?.modelId, "gpt-5-mini");
        assert.match(config.harnesses.pi.agentDir ?? "", /fixtures\/config\/\.pi-agent$/u);
        assert.match(config.harnesses.pi.sessionDir ?? "", /fixtures\/config\/\.pi-sessions$/u);

        const redacted = decodeRedactedConfig(redactServerConfig(config));
        const serialized = JSON.stringify(redacted);
        assert.notInclude(serialized, "openai-secret");
        assert.notInclude(serialized, "telegram-secret");
        assert.notInclude(serialized, "discord-inline-secret");
        assert.notInclude(serialized, "slack-bot-secret");
        assert.notInclude(serialized, "slack-app-secret");
      }),
    );

    it.effect("loads an inline chat token and redacts it", () =>
      Effect.gen(function* () {
        const config = yield* loadEffectiveServerConfig(fixturePath("inline-token.jsonc"));

        assert.isDefined(config.chats.telegram);
        if (config.chats.telegram === undefined) return;

        assert.strictEqual(
          Redacted.value(config.chats.telegram.token.value),
          "telegram-inline-secret",
        );

        const redacted = decodeRedactedConfig(redactServerConfig(config));
        assert.strictEqual(redacted.chats.telegram?.token.source, "value");
        assert.notInclude(JSON.stringify(redacted), "telegram-inline-secret");
      }),
    );

    it.effect("loads a multi-adapter embedded harness config", () =>
      Effect.gen(function* () {
        const config = yield* loadEffectiveServerConfig(
          fixturePath("multi-adapter-embedded.jsonc"),
        );

        assert.isDefined(config.harnesses.opencode);
        assert.isDefined(config.harnesses.pi);
        if (config.harnesses.opencode === undefined || config.harnesses.pi === undefined) return;

        assert.strictEqual(config.xmux.attachments.enabled, false);
        assert.strictEqual(config.harnesses.opencode.runtime.type, "embedded");
        if (config.harnesses.opencode.runtime.type === "embedded") {
          assert.strictEqual(config.harnesses.opencode.runtime.port, 34567);
        }
        assert.strictEqual(config.harnesses.opencode.defaultThinking, "high");
        assert.strictEqual(config.harnesses.pi.defaultThinking, undefined);
        assert.match(config.harnesses.pi.agentDir ?? "", /\/xmux\/pi-agent$/u);
      }),
    );

    it.effect("returns a typed validation issue for invalid but realistic user config", () =>
      Effect.gen(function* () {
        const result = yield* validateServerConfig(fixturePath("invalid-missing-access.jsonc"));
        const decoded = decodeValidationResult(result);

        assert.isFalse(decoded.valid);
        if (decoded.valid) return;
        assert.strictEqual(decoded.issues[0]?.code, "ConfigValidationError");
        assert.include(decoded.issues[0]?.message ?? "", "chats.telegram.access");
      }),
    );

    it.effect("fails schema-invalid fixture with ConfigValidationError", () =>
      Effect.gen(function* () {
        const error = yield* loadEffectiveServerConfig(
          fixturePath("invalid-opencode-url.jsonc"),
        ).pipe(Effect.catchTag("ConfigValidationError", (failure) => Effect.succeed(failure)));

        assert.instanceOf(error, ConfigValidationError);
        assert.include(error.message, "URL");
      }),
    );
  });
});
