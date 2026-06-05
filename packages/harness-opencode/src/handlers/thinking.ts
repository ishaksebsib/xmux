import type {
  HarnessAdapterGetThinkingInput,
  HarnessAdapterSetThinkingInput,
  HarnessModelRef,
  HarnessSelectedThinking,
  HarnessThinkingLevel,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { OpenCodeModelSelectionError } from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { defaultOpenCodeThinkingLevelMap, orderedOpenCodeThinkingLevels } from "../thinking-levels";
import type { OpenCodeCreateOptions, OpenCodeModelInfo } from "../types";

function thinkingLevelMap(runtime: OpenCodeRuntime) {
  return runtime.thinkingLevelMap ?? defaultOpenCodeThinkingLevelMap;
}

function hasThinkingLevel(runtime: OpenCodeRuntime, level: HarnessThinkingLevel): boolean {
  const map = thinkingLevelMap(runtime);
  return Object.hasOwn(map, level) && map[level] !== null;
}

export function supportedThinkingLevelsForModel(args: {
  readonly runtime: OpenCodeRuntime;
  readonly model?: OpenCodeModelInfo["model"];
}): HarnessThinkingLevel[] {
  if (args.model && !args.model.capabilities.reasoning) return ["off"];

  return orderedOpenCodeThinkingLevels.filter((level) => {
    if (!hasThinkingLevel(args.runtime, level)) return false;

    const variant = thinkingLevelMap(args.runtime)[level];
    return (
      variant === undefined ||
      (typeof variant === "string" && args.model?.variants?.[variant] !== undefined)
    );
  });
}

export function thinkingVariantForLevel(args: {
  readonly runtime: OpenCodeRuntime;
  readonly level: HarnessThinkingLevel;
}): ResultType<string | undefined, OpenCodeModelSelectionError> {
  if (!hasThinkingLevel(args.runtime, args.level)) {
    return Result.err(
      new OpenCodeModelSelectionError({
        modelId: `thinking:${args.level}`,
        reason: "thinking level is not supported by this OpenCode adapter configuration",
      }),
    );
  }

  const variant = thinkingLevelMap(args.runtime)[args.level];
  return Result.ok(variant === null ? undefined : variant);
}

export function applyThinkingToModel(args: {
  readonly runtime: OpenCodeRuntime;
  readonly model: HarnessModelRef | undefined;
  readonly level: HarnessThinkingLevel | undefined;
}): ResultType<HarnessModelRef | undefined, OpenCodeModelSelectionError> {
  if (!args.level) return Result.ok(args.model);

  return Result.andThen(
    thinkingVariantForLevel({ runtime: args.runtime, level: args.level }),
    (variantValue) => {
      if (!args.model) return Result.ok(args.model);

      return Result.ok({
        ...args.model,
        ...(variantValue === undefined ? { variant: undefined } : { variant: variantValue }),
      });
    },
  );
}

function thinkingLevelForVariant(args: {
  readonly runtime: OpenCodeRuntime;
  readonly variant?: string;
}): HarnessThinkingLevel | undefined {
  for (const level of orderedOpenCodeThinkingLevels) {
    if (
      hasThinkingLevel(args.runtime, level) &&
      thinkingLevelMap(args.runtime)[level] === args.variant
    ) {
      return level;
    }
  }

  return undefined;
}

export function getEffectiveThinking(args: {
  readonly runtime: OpenCodeRuntime;
  readonly target: HarnessAdapterGetThinkingInput<"opencode", OpenCodeCreateOptions>["target"];
}): HarnessSelectedThinking<"opencode"> {
  if (args.target.type === "harness") {
    if (args.runtime.defaultThinking) {
      return { target: args.target, level: args.runtime.defaultThinking, source: "harness" };
    }

    const modelThinking = args.runtime.defaultModel
      ? thinkingLevelForVariant({
          runtime: args.runtime,
          variant: args.runtime.defaultModel.variant,
        })
      : undefined;
    return modelThinking
      ? { target: args.target, level: modelThinking, source: "native" }
      : { target: args.target, source: "unset" };
  }

  const sessionThinkingLevel = args.runtime.sessionThinking.get(args.target.ref.sessionId);
  if (sessionThinkingLevel) {
    return { target: args.target, level: sessionThinkingLevel, source: "session" };
  }

  const sessionModel = args.runtime.sessionModels.get(args.target.ref.sessionId);
  const modelThinking = sessionModel
    ? thinkingLevelForVariant({
        runtime: args.runtime,
        variant: sessionModel.variant,
      })
    : undefined;
  if (modelThinking) {
    return { target: args.target, level: modelThinking, source: "native" };
  }

  return args.runtime.defaultThinking
    ? { target: args.target, level: args.runtime.defaultThinking, source: "harness" }
    : { target: args.target, source: "unset" };
}

export async function getThinking(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterGetThinkingInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"opencode">, never>> {
  return Result.ok(getEffectiveThinking({ runtime, target: input.target }));
}

export async function setThinking(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterSetThinkingInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"opencode">, OpenCodeModelSelectionError>> {
  if (input.update.type !== "set") {
    if (input.target.type === "harness") {
      runtime.defaultThinking = undefined;
    } else {
      runtime.sessionThinking.delete(input.target.ref.sessionId);
    }
    return Result.ok(getEffectiveThinking({ runtime, target: input.target }));
  }

  const update = input.update;
  return Result.gen(async function* () {
    const variantValue = yield* thinkingVariantForLevel({ runtime, level: update.level });

    if (input.target.type === "harness") {
      runtime.defaultThinking = update.level;
    } else {
      runtime.sessionThinking.set(input.target.ref.sessionId, update.level);

      const model = runtime.sessionModels.get(input.target.ref.sessionId);
      if (model) {
        runtime.sessionModels.set(input.target.ref.sessionId, {
          ...model,
          ...(variantValue === undefined ? { variant: undefined } : { variant: variantValue }),
        });
      }
    }

    return Result.ok(getEffectiveThinking({ runtime, target: input.target }));
  });
}
