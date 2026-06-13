import path from "node:path";
import type { HarnessModelRef } from "@xmux/harness-core";
import type { PiAdapterConfig, PiCreateOptions } from "./types";

export type NormalizedPiAdapterConfig = PiAdapterConfig;

type MutablePiConfig = {
  -readonly [TKey in keyof PiAdapterConfig]: PiAdapterConfig[TKey];
};

type MutablePiCreateOptions = {
  -readonly [TKey in keyof PiCreateOptions]: PiCreateOptions[TKey];
};

function normalizePath(value: string): string {
  return path.resolve(value);
}

function cloneModelRef(model: HarnessModelRef): HarnessModelRef {
  return { ...model };
}

function copyConfigValue(
  target: MutablePiConfig,
  key: keyof PiAdapterConfig,
  value: PiAdapterConfig[keyof PiAdapterConfig],
): void {
  if (value === undefined) return;

  switch (key) {
    case "agentDir":
    case "sessionDir":
      target[key] = normalizePath(value as string);
      return;
    case "defaultModel":
      target.defaultModel = cloneModelRef(value as HarnessModelRef);
      return;
    case "tools":
    case "excludeTools":
      target[key] = [...(value as readonly string[])];
      return;
    case "defaultThinking":
    case "noTools":
      target[key] = value as never;
      return;
  }
}

function copyCreateOptionValue(
  target: MutablePiCreateOptions,
  key: keyof PiCreateOptions,
  value: PiCreateOptions[keyof PiCreateOptions],
): void {
  if (value === undefined) return;

  switch (key) {
    case "agentDir":
    case "sessionDir":
    case "sessionPath":
      target[key] = normalizePath(value as string);
      return;
    case "tools":
    case "excludeTools":
      target[key] = [...(value as readonly string[])];
      return;
    case "parentSession":
    case "noTools":
      target[key] = value as never;
      return;
  }
}

/**
 * Normalizes adapter defaults once at factory creation so later handlers can
 * rely on absolute Pi paths and cloned immutable-looking option arrays.
 */
export function normalizePiAdapterConfig(
  config: PiAdapterConfig | undefined,
): NormalizedPiAdapterConfig {
  const normalized: MutablePiConfig = {};
  if (!config) return normalized;

  copyConfigValue(normalized, "agentDir", config.agentDir);
  copyConfigValue(normalized, "sessionDir", config.sessionDir);
  copyConfigValue(normalized, "defaultModel", config.defaultModel);
  copyConfigValue(normalized, "defaultThinking", config.defaultThinking);
  copyConfigValue(normalized, "tools", config.tools);
  copyConfigValue(normalized, "excludeTools", config.excludeTools);
  copyConfigValue(normalized, "noTools", config.noTools);

  return normalized;
}

/**
 * Merges per-call Pi options over adapter defaults without mutating either input,
 * keeping session-specific paths and tool policy local to a single operation.
 */
export function mergePiCreateOptions(
  config: NormalizedPiAdapterConfig,
  adapterOptions: PiCreateOptions | undefined,
): PiCreateOptions {
  const merged: MutablePiCreateOptions = {};

  copyCreateOptionValue(merged, "agentDir", config.agentDir);
  copyCreateOptionValue(merged, "sessionDir", config.sessionDir);
  copyCreateOptionValue(merged, "tools", config.tools);
  copyCreateOptionValue(merged, "excludeTools", config.excludeTools);
  copyCreateOptionValue(merged, "noTools", config.noTools);

  if (!adapterOptions) return merged;

  copyCreateOptionValue(merged, "agentDir", adapterOptions.agentDir);
  copyCreateOptionValue(merged, "sessionDir", adapterOptions.sessionDir);
  copyCreateOptionValue(merged, "sessionPath", adapterOptions.sessionPath);
  copyCreateOptionValue(merged, "parentSession", adapterOptions.parentSession);
  copyCreateOptionValue(merged, "tools", adapterOptions.tools);
  copyCreateOptionValue(merged, "excludeTools", adapterOptions.excludeTools);
  copyCreateOptionValue(merged, "noTools", adapterOptions.noTools);

  return merged;
}

export const normalizeConfig = normalizePiAdapterConfig;
