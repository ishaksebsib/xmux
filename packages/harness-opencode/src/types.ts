import type { Model, PermissionRuleset, Provider } from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterDefinition,
  HarnessModelRef,
  HarnessThinkingLevel,
  HarnessThinkingLevelMap,
} from "@xmux/harness-core";

export type OpenCodeThinkingNativeValue = string | undefined;

export type OpenCodeCreateOptions = {
  readonly parentId?: string;
  readonly permission?: PermissionRuleset;
  readonly workspace?: string;
  readonly workspaceId?: string;
};

export type OpenCodeSessionInfo = {
  readonly directory: string;
  readonly path?: string;
  readonly projectId: string;
  readonly slug: string;
  readonly version: string;
  readonly workspaceId?: string;
};

export type OpenCodeModelVariant = {
  readonly id: string;
  readonly data: Record<string, unknown>;
};

export type OpenCodeModelInfo = {
  readonly provider: Provider;
  readonly model: Model;
  readonly variant?: OpenCodeModelVariant;
};

export type OpenCodeSharedConfig = {
  readonly defaultModel?: HarnessModelRef;
  readonly defaultThinking?: HarnessThinkingLevel;
  readonly thinkingLevelMap?: HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;
};

export type OpenCodeEmbeddedConfig = OpenCodeSharedConfig & {
  readonly mode?: "embedded";
  readonly port?: number;
};

export type OpenCodeExternalConfig = OpenCodeSharedConfig & {
  readonly mode: "external";
  readonly baseUrl: string;
};

export type OpenCodeAdapterConfig = OpenCodeEmbeddedConfig | OpenCodeExternalConfig;

export type OpenCodeAdapter = HarnessAdapterDefinition<
  "opencode",
  OpenCodeCreateOptions,
  OpenCodeSessionInfo,
  OpenCodeModelInfo
>;
