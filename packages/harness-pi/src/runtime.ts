import type { HarnessModelRef, HarnessThinkingLevel } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiRuntimeOpenError } from "./errors";
import {
  normalizeConfig,
  type NormalizedPiAdapterConfig,
} from "./config";
import type { PiAdapterConfig } from "./types";

export type PiSessionHandle = {
  readonly session: unknown;
  readonly cwd: string;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  dispose(): void;
};

export type PiRuntime = {
  readonly config: NormalizedPiAdapterConfig;
  readonly sessions: Map<string, PiSessionHandle>;
  defaultModel?: HarnessModelRef;
  defaultThinking?: HarnessThinkingLevel;
  close(): Promise<void>;
};

export { normalizeConfig, normalizePiAdapterConfig } from "./config";

export async function openRuntime(
  config: NormalizedPiAdapterConfig,
): Promise<ResultType<PiRuntime, PiRuntimeOpenError>> {
  return Result.try({
    try: () => {
      const sessions = new Map<string, PiSessionHandle>();

      return {
        config,
        sessions,
        defaultModel: config.defaultModel,
        defaultThinking: config.defaultThinking,
        close: async () => {
          for (const session of sessions.values()) {
            session.dispose();
          }
          sessions.clear();
        },
      } satisfies PiRuntime;
    },
    catch: (cause) => new PiRuntimeOpenError({ cause }),
  });
}

export function normalizeRuntimeConfig(config?: PiAdapterConfig): NormalizedPiAdapterConfig {
  return normalizeConfig(config);
}
