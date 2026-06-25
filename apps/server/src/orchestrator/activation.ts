import type { EffectiveServerConfig } from "../config/effective";

interface ActivationRegistryEntry<TId extends string> {
  readonly id: TId;
  readonly isConfigured: (config: EffectiveServerConfig) => boolean;
}

type CheckedActivationRegistry<TRegistry extends Record<string, ActivationRegistryEntry<string>>> =
  {
    readonly [TKey in keyof TRegistry]: ActivationRegistryEntry<Extract<TKey, string>>;
  };

const defineActivationRegistry = <
  const TRegistry extends Record<string, ActivationRegistryEntry<string>>,
>(
  registry: TRegistry & CheckedActivationRegistry<TRegistry>,
): Readonly<TRegistry> => Object.freeze(registry);

const chatActivationRegistry = defineActivationRegistry({
  telegram: {
    id: "telegram",
    isConfigured: (config) => config.chats.telegram !== undefined,
  },
  discord: {
    id: "discord",
    isConfigured: (config) => config.chats.discord !== undefined,
  },
  slack: {
    id: "slack",
    isConfigured: (config) => config.chats.slack !== undefined,
  },
});

const harnessActivationRegistry = defineActivationRegistry({
  opencode: {
    id: "opencode",
    isConfigured: (config) => config.harnesses.opencode !== undefined,
  },
  pi: {
    id: "pi",
    isConfigured: (config) => config.harnesses.pi !== undefined,
  },
});

export type ServerChatId = keyof typeof chatActivationRegistry;
export type ServerHarnessId = keyof typeof harnessActivationRegistry;

const configuredIds = <TId extends string>(
  registry: Readonly<Record<string, ActivationRegistryEntry<TId>>>,
  config: EffectiveServerConfig,
): ReadonlyArray<TId> => {
  const ids: TId[] = [];

  for (const entry of Object.values(registry)) {
    if (entry.isConfigured(config)) ids.push(entry.id);
  }

  return Object.freeze(ids);
};

export type OrchestratorActivation =
  | {
      readonly _tag: "Disabled";
      readonly reason: "NoChatsConfigured";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
    }
  | {
      readonly _tag: "Invalid";
      readonly reason: "ChatsWithoutHarnesses";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
      readonly message: string;
    }
  | {
      readonly _tag: "Enabled";
      readonly chats: ReadonlyArray<ServerChatId>;
      readonly harnesses: ReadonlyArray<ServerHarnessId>;
      readonly config: EffectiveServerConfig;
    };

export const configuredChatIds = (config: EffectiveServerConfig): ReadonlyArray<ServerChatId> =>
  configuredIds(chatActivationRegistry, config);

export const configuredHarnessIds = (
  config: EffectiveServerConfig,
): ReadonlyArray<ServerHarnessId> => configuredIds(harnessActivationRegistry, config);

export const decideOrchestratorActivation = (
  config: EffectiveServerConfig,
): OrchestratorActivation => {
  const chats = configuredChatIds(config);
  const harnesses = configuredHarnessIds(config);

  if (chats.length === 0) {
    return { _tag: "Disabled", reason: "NoChatsConfigured", chats, harnesses };
  }

  if (harnesses.length === 0) {
    return {
      _tag: "Invalid",
      reason: "ChatsWithoutHarnesses",
      chats,
      harnesses,
      message: "At least one harness must be configured when chat adapters are enabled.",
    };
  }

  return { _tag: "Enabled", chats, harnesses, config };
};
