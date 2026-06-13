import type { HarnessModelRef, HarnessThinkingLevel } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  normalizeConfig,
  type NormalizedPiAdapterConfig,
} from "./config";
import { PiRuntimeOpenError } from "./errors";
import type { PiAdapterConfig } from "./types";

/**
 * Live Pi session tracked by the adapter runtime so handler operations can reuse
 * SDK sessions and runtime shutdown can release every session it created.
 */
export type PiSessionHandle = {
  readonly session: unknown;
  readonly cwd: string;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  dispose(): void;
};

/**
 * Adapter-owned Pi runtime state keeps live sessions and mutable defaults scoped
 * to one opened adapter instead of leaking through module globals.
 */
export type PiRuntime = {
  readonly config: NormalizedPiAdapterConfig;
  readonly sessions: Map<string, PiSessionHandle>;
  defaultModel?: HarnessModelRef;
  defaultThinking?: HarnessThinkingLevel;
  close(): Promise<void>;
};

export { normalizeConfig, normalizePiAdapterConfig } from "./config";

function closeSessions(sessions: Map<string, PiSessionHandle>): void {
  const failures: unknown[] = [];

  try {
    for (const session of sessions.values()) {
      const result = Result.try({
        try: () => session.dispose(),
        catch: (cause) => cause,
      });
      if (result.isErr()) failures.push(result.error);
    }
  } finally {
    sessions.clear();
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "Failed to close one or more Pi sessions");
  }
}

/**
 * Opens the lightweight Pi runtime; Pi SDK sessions are created lazily by
 * handlers so adapter startup remains cheap and does not require model auth.
 */
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
        close: async () => closeSessions(sessions),
      } satisfies PiRuntime;
    },
    catch: (cause) => new PiRuntimeOpenError({ cause }),
  });
}

/** Normalizes runtime config for callers that need the same path handling as the adapter factory. */
export function normalizeRuntimeConfig(config?: PiAdapterConfig): NormalizedPiAdapterConfig {
  return normalizeConfig(config);
}
