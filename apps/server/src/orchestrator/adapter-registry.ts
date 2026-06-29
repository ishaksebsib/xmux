import type { EffectiveServerConfig } from "../config/effective";
import type { ServerFileConfig } from "../contracts/config";

interface AdapterConfigRegistryEntry<TId extends string> {
  readonly id: TId;
  readonly isEffectiveConfigured: (config: EffectiveServerConfig) => boolean;
  readonly isFileConfigured: (config: ServerFileConfig) => boolean;
}

type CheckedAdapterConfigRegistry<
  TRegistry extends Record<string, AdapterConfigRegistryEntry<string>>,
> = {
  readonly [TKey in keyof TRegistry]: AdapterConfigRegistryEntry<Extract<TKey, string>>;
};

const defineAdapterConfigRegistry = <
  const TRegistry extends Record<string, AdapterConfigRegistryEntry<string>>,
>(
  registry: TRegistry & CheckedAdapterConfigRegistry<TRegistry>,
): Readonly<TRegistry> => Object.freeze(registry);

export const chatAdapterConfigRegistry = defineAdapterConfigRegistry({
  telegram: {
    id: "telegram",
    isEffectiveConfigured: (config) => config.chats.telegram?.enabled === true,
    isFileConfigured: (config) => config.chats?.telegram?.enabled === true,
  },
  discord: {
    id: "discord",
    isEffectiveConfigured: (config) => config.chats.discord?.enabled === true,
    isFileConfigured: (config) => config.chats?.discord?.enabled === true,
  },
  slack: {
    id: "slack",
    isEffectiveConfigured: (config) => config.chats.slack?.enabled === true,
    isFileConfigured: (config) => config.chats?.slack?.enabled === true,
  },
});

export const harnessAdapterConfigRegistry = defineAdapterConfigRegistry({
  opencode: {
    id: "opencode",
    isEffectiveConfigured: (config) => config.harnesses.opencode?.enabled === true,
    isFileConfigured: (config) => config.harnesses?.opencode?.enabled === true,
  },
  pi: {
    id: "pi",
    isEffectiveConfigured: (config) => config.harnesses.pi?.enabled === true,
    isFileConfigured: (config) => config.harnesses?.pi?.enabled === true,
  },
});

export type ServerChatId = keyof typeof chatAdapterConfigRegistry;
export type ServerHarnessId = keyof typeof harnessAdapterConfigRegistry;

const configuredEffectiveIds = <TId extends string>(
  registry: Readonly<Record<string, AdapterConfigRegistryEntry<TId>>>,
  config: EffectiveServerConfig,
): ReadonlyArray<TId> => {
  const ids: TId[] = [];

  for (const entry of Object.values(registry)) {
    if (entry.isEffectiveConfigured(config)) ids.push(entry.id);
  }

  return Object.freeze(ids);
};

const configuredFileIds = <TId extends string>(
  registry: Readonly<Record<string, AdapterConfigRegistryEntry<TId>>>,
  config: ServerFileConfig,
): ReadonlyArray<TId> => {
  const ids: TId[] = [];

  for (const entry of Object.values(registry)) {
    if (entry.isFileConfigured(config)) ids.push(entry.id);
  }

  return Object.freeze(ids);
};

export const configuredEffectiveChatIds = (
  config: EffectiveServerConfig,
): ReadonlyArray<ServerChatId> => configuredEffectiveIds(chatAdapterConfigRegistry, config);

export const configuredEffectiveHarnessIds = (
  config: EffectiveServerConfig,
): ReadonlyArray<ServerHarnessId> => configuredEffectiveIds(harnessAdapterConfigRegistry, config);

export const configuredFileChatIds = (config: ServerFileConfig): ReadonlyArray<ServerChatId> =>
  configuredFileIds(chatAdapterConfigRegistry, config);

export const configuredFileHarnessIds = (
  config: ServerFileConfig,
): ReadonlyArray<ServerHarnessId> => configuredFileIds(harnessAdapterConfigRegistry, config);
