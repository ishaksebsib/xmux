import type { OpenCodeAdapterConfig } from "./types";

export function normalizeOpenCodeAdapterConfig(
  config: OpenCodeAdapterConfig | undefined,
): OpenCodeAdapterConfig {
  return config ?? { mode: "embedded" };
}

export const normalizeConfig = normalizeOpenCodeAdapterConfig;
