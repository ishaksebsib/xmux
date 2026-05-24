import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { HarnessModelRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeRuntimeOpenError } from "./errors";

type SharedConfig = {
  readonly defaultModel?: HarnessModelRef;
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
  defaultModel?: HarnessModelRef;
  readonly sessionModels: Map<string, HarnessModelRef>;
  close(): Promise<void>;
};

export function normalizeConfig(config: OpenCodeAdapterConfig | undefined): OpenCodeAdapterConfig {
  return config ?? { mode: "embedded" };
}

function createExternalRuntime(
  config: ExternalConfig,
): ResultType<OpenCodeRuntime, OpenCodeRuntimeOpenError> {
  return Result.try({
    try: () => ({
      client: createOpencodeClient({ baseUrl: config.baseUrl }),
      defaultModel: config.defaultModel,
      sessionModels: new Map<string, HarnessModelRef>(),
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
        defaultModel: config.defaultModel,
        sessionModels: new Map<string, HarnessModelRef>(),
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
