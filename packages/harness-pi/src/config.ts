import path from "node:path";
import type { PiAdapterConfig, PiCreateOptions } from "./types";

export type NormalizedPiAdapterConfig = PiAdapterConfig;

function normalizePath(value: string | undefined): string | undefined {
  return value === undefined ? undefined : path.resolve(value);
}

export function normalizePiAdapterConfig(
  config: PiAdapterConfig | undefined,
): NormalizedPiAdapterConfig {
  return {
    ...config,
    agentDir: normalizePath(config?.agentDir),
    sessionDir: normalizePath(config?.sessionDir),
    tools: config?.tools === undefined ? undefined : [...config.tools],
    excludeTools: config?.excludeTools === undefined ? undefined : [...config.excludeTools],
  };
}

export function mergePiCreateOptions(
  config: NormalizedPiAdapterConfig,
  adapterOptions: PiCreateOptions | undefined,
): PiCreateOptions {
  return {
    agentDir: normalizePath(adapterOptions?.agentDir) ?? config.agentDir,
    sessionDir: normalizePath(adapterOptions?.sessionDir) ?? config.sessionDir,
    sessionPath: normalizePath(adapterOptions?.sessionPath),
    parentSession: adapterOptions?.parentSession,
    tools: adapterOptions?.tools === undefined ? config.tools : [...adapterOptions.tools],
    excludeTools:
      adapterOptions?.excludeTools === undefined ? config.excludeTools : [...adapterOptions.excludeTools],
    noTools: adapterOptions?.noTools ?? config.noTools,
  };
}

export const normalizeConfig = normalizePiAdapterConfig;
