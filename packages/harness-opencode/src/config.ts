import { Result, type Result as ResultType } from "better-result";
import { OpenCodeConfigurationError } from "./errors";
import type {
  OpenCodeAdapterConfig,
  OpenCodeSharedConfig,
  ResolvedOpenCodeAdapterConfig,
  ResolvedOpenCodeEmbeddedConfig,
  ResolvedOpenCodeExternalConfig,
} from "./types";

declare const openCodeBaseUrlBrand: unique symbol;
declare const openCodePortBrand: unique symbol;

export type OpenCodeBaseUrl = string & { readonly [openCodeBaseUrlBrand]: true };
export type OpenCodePort = number & { readonly [openCodePortBrand]: true };

function copySharedConfig(config: OpenCodeSharedConfig): OpenCodeSharedConfig {
  return {
    ...(config.defaultModel === undefined ? {} : { defaultModel: { ...config.defaultModel } }),
    ...(config.defaultThinking === undefined ? {} : { defaultThinking: config.defaultThinking }),
    ...(config.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: { ...config.thinkingLevelMap } }),
  };
}

function parseOpenCodePort(
  port: number | undefined,
): ResultType<OpenCodePort | undefined, OpenCodeConfigurationError> {
  if (port === undefined) return Result.ok(undefined);
  return Number.isInteger(port) && port > 0
    ? Result.ok(port as OpenCodePort)
    : Result.err(
        new OpenCodeConfigurationError({
          field: "port",
          reason: "OpenCode embedded port must be a positive integer when provided",
        }),
      );
}

function parseOpenCodeBaseUrl(
  baseUrl: string | undefined,
): ResultType<OpenCodeBaseUrl, OpenCodeConfigurationError> {
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    return Result.err(
      new OpenCodeConfigurationError({
        field: "baseUrl",
        reason: "OpenCode external mode requires a non-empty baseUrl",
      }),
    );
  }

  return Result.try({
    try: () => {
      new URL(baseUrl.trim());
      return baseUrl.trim() as OpenCodeBaseUrl;
    },
    catch: (cause) => new OpenCodeConfigurationError({ field: "baseUrl", cause }),
  });
}

export function parseOpenCodeAdapterConfig(
  config: OpenCodeAdapterConfig | undefined,
): ResultType<ResolvedOpenCodeAdapterConfig, OpenCodeConfigurationError> {
  return Result.gen(function* () {
    const input: OpenCodeAdapterConfig = config ?? { mode: "embedded" };
    const shared = copySharedConfig(input);

    if (input.mode === "external") {
      const baseUrl = yield* parseOpenCodeBaseUrl(input.baseUrl);
      const resolved: ResolvedOpenCodeExternalConfig = {
        ...shared,
        mode: "external",
        baseUrl,
      };
      return Result.ok(resolved);
    }

    const port = yield* parseOpenCodePort(input.port);
    const resolved: ResolvedOpenCodeEmbeddedConfig = {
      ...shared,
      mode: "embedded",
      ...(port === undefined ? {} : { port }),
    };
    return Result.ok(resolved);
  });
}

/**
 * Legacy compatibility wrapper. New code should use parseOpenCodeAdapterConfig()
 * and carry ResolvedOpenCodeAdapterConfig after the boundary.
 */
export function normalizeOpenCodeAdapterConfig(
  config: OpenCodeAdapterConfig | undefined,
): ResolvedOpenCodeAdapterConfig {
  const parsed = parseOpenCodeAdapterConfig(config);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}

export const normalizeConfig = normalizeOpenCodeAdapterConfig;
