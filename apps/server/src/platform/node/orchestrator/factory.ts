import type { ChatAdapterDefinition, ChatAdapterObject } from "@xmux/chat-core";
import type { HarnessAdapterDefinition, HarnessAdapterObject } from "@xmux/harness-core";
import { Effect, Layer } from "effect";
import type { EffectiveChatsConfig, EffectiveHarnessesConfig } from "../../../config/effective";
import type { ServerChatId, ServerHarnessId } from "../../../orchestrator/activation";
import { OrchestratorConfigurationError } from "../../../orchestrator/errors";
import { OrchestratorFactory } from "../../../orchestrator/factory";
import { createXmuxRuntime } from "../../../orchestrator/runtime";
import {
  makeDiscordAdapter,
  makeOpenCodeAdapter,
  makePiAdapter,
  makeSlackAdapter,
  makeTelegramAdapter,
} from "./adapters";

type ServerChatAdapter<TId extends string = string> = ChatAdapterDefinition<
  TId,
  ChatAdapterObject,
  ChatAdapterObject
>;
type ServerHarnessAdapter<TId extends string = string> = HarnessAdapterDefinition<
  TId,
  HarnessAdapterObject,
  HarnessAdapterObject,
  HarnessAdapterObject
>;

type ServerChatAdapters = Record<string, ServerChatAdapter>;
type ServerHarnessAdapters = Record<string, ServerHarnessAdapter>;

interface ChatAdapterRegistryEntry<TId extends ServerChatId> {
  readonly build: (config: EffectiveChatsConfig) => ServerChatAdapter<TId> | undefined;
}

interface HarnessAdapterRegistryEntry<TId extends ServerHarnessId> {
  readonly build: (config: EffectiveHarnessesConfig) => ServerHarnessAdapter<TId> | undefined;
}

type CheckedChatAdapterRegistry<
  TRegistry extends Record<ServerChatId, ChatAdapterRegistryEntry<ServerChatId>>,
> = {
  readonly [TKey in keyof TRegistry]: ChatAdapterRegistryEntry<Extract<TKey, ServerChatId>>;
};

type CheckedHarnessAdapterRegistry<
  TRegistry extends Record<ServerHarnessId, HarnessAdapterRegistryEntry<ServerHarnessId>>,
> = {
  readonly [TKey in keyof TRegistry]: HarnessAdapterRegistryEntry<Extract<TKey, ServerHarnessId>>;
};

const defineChatAdapterRegistry = <
  const TRegistry extends Record<ServerChatId, ChatAdapterRegistryEntry<ServerChatId>>,
>(
  registry: TRegistry & CheckedChatAdapterRegistry<TRegistry>,
): Readonly<TRegistry> => Object.freeze(registry);

const defineHarnessAdapterRegistry = <
  const TRegistry extends Record<ServerHarnessId, HarnessAdapterRegistryEntry<ServerHarnessId>>,
>(
  registry: TRegistry & CheckedHarnessAdapterRegistry<TRegistry>,
): Readonly<TRegistry> => Object.freeze(registry);

const chatAdapterRegistry = defineChatAdapterRegistry({
  telegram: {
    build: (config) =>
      config.telegram === undefined ? undefined : makeTelegramAdapter(config.telegram),
  },
  discord: {
    build: (config) =>
      config.discord === undefined ? undefined : makeDiscordAdapter(config.discord),
  },
  slack: {
    build: (config) => (config.slack === undefined ? undefined : makeSlackAdapter(config.slack)),
  },
});

const harnessAdapterRegistry = defineHarnessAdapterRegistry({
  opencode: {
    build: (config) =>
      config.opencode === undefined ? undefined : makeOpenCodeAdapter(config.opencode),
  },
  pi: {
    build: (config) => (config.pi === undefined ? undefined : makePiAdapter(config.pi)),
  },
});

const makeConfiguredChatAdapters = (config: EffectiveChatsConfig): ServerChatAdapters => {
  const adapters: ServerChatAdapters = {};

  for (const entry of Object.values(chatAdapterRegistry)) {
    const adapter = entry.build(config);
    if (adapter !== undefined) adapters[adapter.id] = adapter;
  }

  return Object.freeze(adapters);
};

const makeConfiguredHarnessAdapters = (config: EffectiveHarnessesConfig): ServerHarnessAdapters => {
  const adapters: ServerHarnessAdapters = {};

  for (const entry of Object.values(harnessAdapterRegistry)) {
    const adapter = entry.build(config);
    if (adapter !== undefined) adapters[adapter.id] = adapter;
  }

  return Object.freeze(adapters);
};

const hasAdapters = (adapters: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(adapters).length > 0;

const missingAdaptersError = (path: "chats" | "harnesses") =>
  OrchestratorConfigurationError.make({
    path,
    reason: "NoAdaptersConfigured",
    message: `Cannot create orchestrator runtime without configured ${path}.`,
  });

export const nodeOrchestratorFactoryLayer = Layer.succeed(OrchestratorFactory)({
  create: Effect.fn("server.node.orchestrator.create")(function* (input) {
    const harnesses = makeConfiguredHarnessAdapters(input.effectiveConfig.harnesses);
    if (!hasAdapters(harnesses)) return yield* missingAdaptersError("harnesses");

    const chats = makeConfiguredChatAdapters(input.effectiveConfig.chats);
    if (!hasAdapters(chats)) return yield* missingAdaptersError("chats");

    return yield* createXmuxRuntime({
      harnesses,
      chats,
      config: input.config,
      store: input.store,
      logger: input.logger,
    });
  }),
});
