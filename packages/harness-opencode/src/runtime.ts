import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2";
import type {
  HarnessModelRef,
  HarnessThinkingLevel,
  HarnessThinkingLevelMap,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeRuntimeOpenError } from "./errors";

type OpenCodeThinkingNativeValue = string | undefined;

type SharedConfig = {
  readonly defaultModel?: HarnessModelRef;
  readonly defaultThinking?: HarnessThinkingLevel;
  readonly thinkingLevelMap?: HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;
};

type EmbeddedConfig = SharedConfig & {
  readonly mode?: "embedded";
  readonly port?: number;
};

type ExternalConfig = SharedConfig & {
  readonly mode: "external";
  readonly baseUrl: string;
};

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export type OpenCodeAdapterConfig = EmbeddedConfig | ExternalConfig;

export type OpenCodeRuntime = {
  readonly client: OpenCodeClient;
  readonly thinkingLevelMap: HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;
  defaultModel?: HarnessModelRef;
  defaultThinking?: HarnessThinkingLevel;
  readonly sessionModels: Map<string, HarnessModelRef>;
  readonly sessionThinking: Map<string, HarnessThinkingLevel>;
  close(): Promise<void>;
};

const defaultThinkingLevelMap = {
  off: undefined,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "code-extreme",
} satisfies HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;

function resolveThinkingLevelMap(
  config: SharedConfig,
): HarnessThinkingLevelMap<OpenCodeThinkingNativeValue> {
  return config.thinkingLevelMap ?? defaultThinkingLevelMap;
}

export function normalizeConfig(config: OpenCodeAdapterConfig | undefined): OpenCodeAdapterConfig {
  return config ?? { mode: "embedded" };
}

function createExternalRuntime(
  config: ExternalConfig,
): ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError> {
  return Result.try({
    try: () => ({
      client: createOpencodeClient({ baseUrl: config.baseUrl }),
      thinkingLevelMap: resolveThinkingLevelMap(config),
      defaultModel: config.defaultModel,
      defaultThinking: config.defaultThinking,
      sessionModels: new Map<string, HarnessModelRef>(),
      sessionThinking: new Map<string, HarnessThinkingLevel>(),
      close: async () => {
        return undefined;
      },
    }),
    catch: (cause) => new OpenCodeRuntimeOpenError({ mode: "external", cause }),
  });
}

async function createEmbeddedRuntime(
  config: EmbeddedConfig,
): Promise<ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError>> {
  return Result.tryPromise({
    try: async () => {
      const runtime = await createOpencode({ port: config.port ?? 0 });

      return {
        client: runtime.client,
        thinkingLevelMap: resolveThinkingLevelMap(config),
        defaultModel: config.defaultModel,
        defaultThinking: config.defaultThinking,
        sessionModels: new Map<string, HarnessModelRef>(),
        sessionThinking: new Map<string, HarnessThinkingLevel>(),
        close: async () => {
          runtime.server.close();
        },
      } satisfies OpenCodeRuntime;
    },
    catch: (cause) => new OpenCodeRuntimeOpenError({ mode: "embedded", cause }),
  });
}

export async function openRuntime(
  config: OpenCodeAdapterConfig,
): Promise<ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError>> {
  return config.mode === "external" ? createExternalRuntime(config) : createEmbeddedRuntime(config);
}
