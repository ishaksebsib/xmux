import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2";
import type {
  HarnessModelRef,
  HarnessThinkingLevel,
  HarnessThinkingLevelMap,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeRuntimeOpenError } from "./errors";
import { defaultOpenCodeThinkingLevelMap } from "./thinking-levels";
import type {
  ResolvedOpenCodeAdapterConfig,
  ResolvedOpenCodeEmbeddedConfig,
  ResolvedOpenCodeExternalConfig,
  OpenCodeSharedConfig,
  OpenCodeThinkingNativeValue,
} from "./types";

type OpenCodeClient = ReturnType<typeof createOpencodeClient>;

export type OpenCodeRuntime = {
  readonly client: OpenCodeClient;
  readonly thinkingLevelMap: HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;
  defaultModel?: HarnessModelRef;
  defaultThinking?: HarnessThinkingLevel;
  readonly sessionModels: Map<string, HarnessModelRef>;
  readonly sessionThinking: Map<string, HarnessThinkingLevel>;
  readonly modelContextLimits: Map<string, number>;
  close(): Promise<void>;
};

function resolveThinkingLevelMap(
  config: OpenCodeSharedConfig,
): HarnessThinkingLevelMap<OpenCodeThinkingNativeValue> {
  return config.thinkingLevelMap ?? defaultOpenCodeThinkingLevelMap;
}

export { normalizeConfig, normalizeOpenCodeAdapterConfig } from "./config";

function createExternalRuntime(
  config: ResolvedOpenCodeExternalConfig,
): ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError> {
  return Result.try({
    try: () => ({
      client: createOpencodeClient({ baseUrl: config.baseUrl }),
      thinkingLevelMap: resolveThinkingLevelMap(config),
      defaultModel: config.defaultModel,
      defaultThinking: config.defaultThinking,
      sessionModels: new Map<string, HarnessModelRef>(),
      sessionThinking: new Map<string, HarnessThinkingLevel>(),
      modelContextLimits: new Map<string, number>(),
      close: async () => {
        return undefined;
      },
    }),
    catch: (cause) => new OpenCodeRuntimeOpenError({ mode: "external", cause }),
  });
}

async function createEmbeddedRuntime(
  config: ResolvedOpenCodeEmbeddedConfig,
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
        modelContextLimits: new Map<string, number>(),
        close: async () => {
          runtime.server.close();
        },
      } satisfies OpenCodeRuntime;
    },
    catch: (cause) => new OpenCodeRuntimeOpenError({ mode: "embedded", cause }),
  });
}

export async function openRuntime(
  config: ResolvedOpenCodeAdapterConfig,
): Promise<ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError>> {
  return config.mode === "external" ? createExternalRuntime(config) : createEmbeddedRuntime(config);
}
