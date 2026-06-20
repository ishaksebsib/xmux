import path from "node:path";
import type { HarnessModelRef } from "@xmux/harness-core";
import type { PiAdapterConfig, PiCreateOptions } from "./types";

declare const resolvedPiPathBrand: unique symbol;

/** Absolute Pi filesystem path resolved at the adapter/per-call boundary. */
export type ResolvedPiPath = string & { readonly [resolvedPiPathBrand]: true };

export type ResolvedPiAdapterConfig = {
  readonly agentDir?: ResolvedPiPath;
  readonly sessionDir?: ResolvedPiPath;
  readonly defaultModel?: HarnessModelRef;
  readonly defaultThinking?: PiAdapterConfig["defaultThinking"];
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: PiAdapterConfig["noTools"];
};

export type ResolvedPiCreateOptions = {
  readonly agentDir?: ResolvedPiPath;
  readonly sessionDir?: ResolvedPiPath;
  readonly sessionPath?: ResolvedPiPath;
  readonly parentSession?: string;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: PiCreateOptions["noTools"];
};

/** @deprecated Use ResolvedPiAdapterConfig. */
export type NormalizedPiAdapterConfig = ResolvedPiAdapterConfig;

function resolvePiPath(value: string): ResolvedPiPath {
  return path.resolve(value) as ResolvedPiPath;
}

function cloneModelRef(model: HarnessModelRef): HarnessModelRef {
  return { ...model };
}

function cloneStringArray(values: readonly string[] | undefined): readonly string[] | undefined {
  return values === undefined ? undefined : Object.freeze([...values]);
}

/**
 * Normalizes adapter defaults once at factory creation so later handlers can
 * rely on absolute Pi paths and cloned immutable option arrays.
 */
export function normalizePiAdapterConfig(
  config: PiAdapterConfig | undefined,
): ResolvedPiAdapterConfig {
  if (config === undefined) return Object.freeze({});

  const agentDir = config.agentDir === undefined ? undefined : resolvePiPath(config.agentDir);
  const sessionDir = config.sessionDir === undefined ? undefined : resolvePiPath(config.sessionDir);
  const defaultModel =
    config.defaultModel === undefined ? undefined : cloneModelRef(config.defaultModel);
  const tools = cloneStringArray(config.tools);
  const excludeTools = cloneStringArray(config.excludeTools);

  return Object.freeze({
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(config.defaultThinking === undefined ? {} : { defaultThinking: config.defaultThinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(config.noTools === undefined ? {} : { noTools: config.noTools }),
  });
}

/**
 * Merges per-call Pi options over adapter defaults without mutating either input,
 * keeping session-specific paths and tool policy local to a single operation.
 */
export function mergePiCreateOptions(
  config: ResolvedPiAdapterConfig,
  adapterOptions: PiCreateOptions | undefined,
): ResolvedPiCreateOptions {
  const agentDir =
    adapterOptions?.agentDir === undefined
      ? config.agentDir
      : resolvePiPath(adapterOptions.agentDir);
  const sessionDir =
    adapterOptions?.sessionDir === undefined
      ? config.sessionDir
      : resolvePiPath(adapterOptions.sessionDir);
  const sessionPath =
    adapterOptions?.sessionPath === undefined
      ? undefined
      : resolvePiPath(adapterOptions.sessionPath);
  const tools = cloneStringArray(adapterOptions?.tools ?? config.tools);
  const excludeTools = cloneStringArray(adapterOptions?.excludeTools ?? config.excludeTools);
  const noTools = adapterOptions?.noTools ?? config.noTools;

  return Object.freeze({
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(sessionPath === undefined ? {} : { sessionPath }),
    ...(adapterOptions?.parentSession === undefined
      ? {}
      : { parentSession: adapterOptions.parentSession }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(noTools === undefined ? {} : { noTools }),
  });
}

export const normalizeConfig = normalizePiAdapterConfig;
