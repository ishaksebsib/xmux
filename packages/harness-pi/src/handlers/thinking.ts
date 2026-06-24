import { HarnessSessionNotFoundError } from "@xmux/harness-core";
import type {
  HarnessAdapterGetThinkingInput,
  HarnessAdapterSetThinkingInput,
  HarnessSelectedThinking,
  HarnessThinkingLevel,
  HarnessThinkingTarget,
  HarnessSessionOperation,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiModelSelectionError, PiSessionNotFoundError, PiSessionRequestError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";
import { toPiThinkingLevel } from "./models";

type PiThinkingHandlerError =
  | PiModelSelectionError
  | PiSessionNotFoundError
  | PiSessionRequestError;

type PiPublicThinkingHandlerError =
  | PiModelSelectionError
  | HarnessSessionNotFoundError
  | PiSessionRequestError;

export function toHarnessThinkingLevel(
  level: string | undefined,
): HarnessThinkingLevel | undefined {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return level;
    default:
      return undefined;
  }
}

function mapSupportedLevels(levels: readonly string[]): readonly HarnessThinkingLevel[] {
  return levels.flatMap((level) => {
    const mapped = toHarnessThinkingLevel(level);
    return mapped ? [mapped] : [];
  });
}

function selectedThinking(args: {
  readonly target: HarnessThinkingTarget<"pi">;
  readonly level?: HarnessThinkingLevel;
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly source: HarnessSelectedThinking<"pi">["source"];
}): HarnessSelectedThinking<"pi"> {
  return args.level
    ? {
        target: args.target,
        level: args.level,
        supportedLevels: args.supportedLevels,
        source: args.source,
      }
    : {
        target: args.target,
        supportedLevels: args.supportedLevels,
        source: args.source,
      };
}

export function getEffectiveThinking(args: {
  readonly runtime: PiRuntime;
  readonly target: HarnessThinkingTarget<"pi">;
}): ResultType<HarnessSelectedThinking<"pi">, PiSessionNotFoundError> {
  if (args.target.type === "harness") {
    return Result.ok(
      selectedThinking({
        target: args.target,
        level: args.runtime.defaultThinking,
        source: args.runtime.defaultThinking ? "harness" : "unset",
      }),
    );
  }

  const handle = args.runtime.sessions.get(args.target.ref.sessionId);
  if (!handle) {
    return Result.err(new PiSessionNotFoundError({ sessionId: args.target.ref.sessionId }));
  }

  return Result.ok(
    selectedThinking({
      target: args.target,
      level: toHarnessThinkingLevel(handle.session.thinkingLevel),
      supportedLevels: mapSupportedLevels(handle.session.getAvailableThinkingLevels()),
      source: "session",
    }),
  );
}

export async function getThinking(
  runtime: PiRuntime,
  input: HarnessAdapterGetThinkingInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"pi">, PiPublicThinkingHandlerError>> {
  return mapPiThinkingSessionError({
    result: getEffectiveThinking({ runtime, target: input.target }),
    target: input.target,
    operation: "getThinking",
  });
}

export async function setThinking(
  runtime: PiRuntime,
  input: HarnessAdapterSetThinkingInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"pi">, PiPublicThinkingHandlerError>> {
  const update = input.update;

  if (update.type === "clear") {
    if (input.target.type !== "harness") {
      return Result.err(
        new PiModelSelectionError({
          modelId: input.target.ref.sessionId,
          reason:
            "Pi does not support clearing a live session thinking level; set another level instead",
        }),
      );
    }

    runtime.defaultThinking = undefined;
    return mapPiThinkingSessionError({
      result: getEffectiveThinking({ runtime, target: input.target }),
      target: input.target,
      operation: "setThinking",
    });
  }

  const selected = await Result.gen(async function* () {
    const level = yield* toPiThinkingLevel({ level: update.level });

    if (input.target.type === "harness") {
      runtime.defaultThinking = level;
      return Result.ok(selectedThinking({ target: input.target, level, source: "harness" }));
    }

    const handle = runtime.sessions.get(input.target.ref.sessionId);
    if (!handle) {
      return Result.err(new PiSessionNotFoundError({ sessionId: input.target.ref.sessionId }));
    }

    yield* Result.try({
      try: () => handle.session.setThinkingLevel(level),
      catch: (cause) => new PiSessionRequestError({ operation: "setThinking", cause }),
    });

    return Result.ok(
      selectedThinking({
        target: input.target,
        level: toHarnessThinkingLevel(handle.session.thinkingLevel),
        supportedLevels: mapSupportedLevels(handle.session.getAvailableThinkingLevels()),
        source: "session",
      }),
    );
  });

  return mapPiThinkingSessionError({
    result: selected,
    target: input.target,
    operation: "setThinking",
  });
}

function mapPiThinkingSessionError<TValue>(input: {
  readonly result: ResultType<TValue, PiThinkingHandlerError>;
  readonly target: HarnessThinkingTarget<"pi">;
  readonly operation: HarnessSessionOperation;
}): ResultType<TValue, PiPublicThinkingHandlerError> {
  if (input.result.isOk()) return Result.ok(input.result.value);

  if (PiSessionNotFoundError.is(input.result.error)) {
    return input.target.type === "session"
      ? Result.err(
          new HarnessSessionNotFoundError({
            ref: input.target.ref,
            operation: input.operation,
            cause: input.result.error,
          }),
        )
      : Result.err(
          new PiSessionRequestError({ operation: input.operation, cause: input.result.error }),
        );
  }

  return Result.err(input.result.error);
}
