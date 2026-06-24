import { AuthStorage, ModelRegistry, type AgentSession } from "@earendil-works/pi-coding-agent";
import { HarnessSessionNotFoundError } from "@xmux/harness-core";
import type {
  HarnessAdapterGetModelInput,
  HarnessAdapterListModelsInput,
  HarnessAdapterSetModelInput,
  HarnessModelInfo,
  HarnessModelRef,
  HarnessModelTarget,
  HarnessSelectedModel,
  HarnessSessionOperation,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import path from "node:path";
import { mergePiCreateOptions } from "../config";
import {
  PiModelRequestError,
  PiModelSelectionError,
  PiSessionNotFoundError,
  PiSessionRequestError,
} from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiModelInfo } from "../types";

export type PiModel = NonNullable<AgentSession["model"]>;

type PiModelHandlerError =
  | PiModelRequestError
  | PiModelSelectionError
  | PiSessionNotFoundError
  | PiSessionRequestError;

type PiPublicModelHandlerError =
  | PiModelRequestError
  | PiModelSelectionError
  | HarnessSessionNotFoundError
  | PiSessionRequestError;

const orderedPiThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type PiThinkingLevel = (typeof orderedPiThinkingLevels)[number];

function cloneHarnessModelRef(model: HarnessModelRef): HarnessModelRef {
  return model.variant === undefined
    ? { providerId: model.providerId, modelId: model.modelId }
    : { providerId: model.providerId, modelId: model.modelId, variant: model.variant };
}

function toSelectedModel(args: {
  readonly target: HarnessModelTarget<"pi">;
  readonly model?: HarnessModelRef;
  readonly source: HarnessSelectedModel<"pi">["source"];
}): HarnessSelectedModel<"pi"> {
  return args.model
    ? { target: args.target, model: cloneHarnessModelRef(args.model), source: args.source }
    : { target: args.target, source: args.source };
}

function toPiModelRef(model: PiModel | undefined): HarnessModelRef | undefined {
  return model ? { providerId: model.provider, modelId: model.id } : undefined;
}

function hasPiThinkingLevel(level: string): level is PiThinkingLevel {
  return orderedPiThinkingLevels.includes(level as PiThinkingLevel);
}

function supportedThinkingLevelsForModel(model: PiModel): readonly PiThinkingLevel[] {
  if (!model.reasoning) return ["off"];

  return orderedPiThinkingLevels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return level === "xhigh" ? mapped !== undefined : true;
  });
}

function toModelStatus(available: boolean): HarnessModelInfo["status"] {
  return available ? "active" : "unavailable";
}

function toHarnessModelInfo(args: {
  readonly registry: ModelRegistry;
  readonly model: PiModel;
}): HarnessModelInfo<"pi", PiModelInfo> {
  const available = args.registry.hasConfiguredAuth(args.model);
  const supportedThinkingLevels = supportedThinkingLevelsForModel(args.model);

  return {
    harnessId: "pi",
    ref: { providerId: args.model.provider, modelId: args.model.id },
    name: args.model.name,
    providerName: args.registry.getProviderDisplayName(args.model.provider),
    status: toModelStatus(available),
    available,
    capabilities: {
      reasoning: args.model.reasoning,
      thinking: {
        supportedLevels: supportedThinkingLevels,
        defaultLevel: supportedThinkingLevels.includes("medium")
          ? "medium"
          : supportedThinkingLevels[0],
      },
      input: args.model.input,
      output: ["text"],
    },
    limits: {
      context: args.model.contextWindow,
      output: args.model.maxTokens,
    },
    cost: args.model.cost,
    adapterData: {
      provider: args.model.provider,
      id: args.model.id,
      api: args.model.api,
      name: args.model.name,
      reasoning: args.model.reasoning,
      contextWindow: args.model.contextWindow,
      maxTokens: args.model.maxTokens,
      input: args.model.input,
    },
  };
}

function sortModelInfos(
  models: readonly HarnessModelInfo<"pi", PiModelInfo>[],
): readonly HarnessModelInfo<"pi", PiModelInfo>[] {
  return [...models].sort((left, right) => {
    const byProvider = (left.providerName ?? left.ref.providerId ?? "").localeCompare(
      right.providerName ?? right.ref.providerId ?? "",
    );
    if (byProvider !== 0) return byProvider;
    return (left.name ?? left.ref.modelId).localeCompare(right.name ?? right.ref.modelId);
  });
}

export function createPiModelRegistry(args: {
  readonly operation: string;
  readonly agentDir?: string;
}): ResultType<ModelRegistry, PiModelRequestError> {
  return Result.gen(function* () {
    const authStorage = yield* Result.try({
      try: () =>
        AuthStorage.create(args.agentDir ? path.join(args.agentDir, "auth.json") : undefined),
      catch: (cause) => new PiModelRequestError({ operation: args.operation, cause }),
    });

    const registry = yield* Result.try({
      try: () =>
        args.agentDir
          ? ModelRegistry.create(authStorage, path.join(args.agentDir, "models.json"))
          : ModelRegistry.create(authStorage),
      catch: (cause) => new PiModelRequestError({ operation: args.operation, cause }),
    });

    const loadError = registry.getError();
    if (loadError) {
      return Result.err(
        new PiModelRequestError({ operation: args.operation, cause: new Error(loadError) }),
      );
    }

    return Result.ok(registry);
  });
}

export function resolvePiModel(args: {
  readonly registry: ModelRegistry;
  readonly model: HarnessModelRef;
}): ResultType<PiModel, PiModelSelectionError> {
  if (!args.model.providerId) {
    return Result.err(
      new PiModelSelectionError({
        modelId: args.model.modelId,
        reason: "providerId is required",
      }),
    );
  }

  if (args.model.variant) {
    return Result.err(
      new PiModelSelectionError({
        providerId: args.model.providerId,
        modelId: args.model.modelId,
        reason: "Pi model variants are not supported",
      }),
    );
  }

  const model = args.registry.find(args.model.providerId, args.model.modelId);
  return model
    ? Result.ok(model as PiModel)
    : Result.err(
        new PiModelSelectionError({
          providerId: args.model.providerId,
          modelId: args.model.modelId,
          reason: "model is not registered in Pi",
        }),
      );
}

export function getEffectiveModel(args: {
  readonly runtime: PiRuntime;
  readonly target: HarnessModelTarget<"pi">;
}): ResultType<HarnessSelectedModel<"pi">, PiSessionNotFoundError> {
  if (args.target.type === "harness") {
    return Result.ok(
      args.runtime.defaultModel
        ? toSelectedModel({
            target: args.target,
            model: args.runtime.defaultModel,
            source: "harness",
          })
        : toSelectedModel({ target: args.target, source: "unset" }),
    );
  }

  const handle = args.runtime.sessions.get(args.target.ref.sessionId);
  if (!handle) {
    return Result.err(new PiSessionNotFoundError({ sessionId: args.target.ref.sessionId }));
  }

  return Result.ok(
    handle.session.model
      ? toSelectedModel({
          target: args.target,
          model: toPiModelRef(handle.session.model),
          source: "session",
        })
      : args.runtime.defaultModel
        ? toSelectedModel({
            target: args.target,
            model: args.runtime.defaultModel,
            source: "harness",
          })
        : toSelectedModel({ target: args.target, source: "unset" }),
  );
}

export async function listModels(
  runtime: PiRuntime,
  input: HarnessAdapterListModelsInput<PiCreateOptions>,
): Promise<ResultType<readonly HarnessModelInfo<"pi", PiModelInfo>[], PiModelRequestError>> {
  const options = mergePiCreateOptions(runtime.config, input.adapterOptions);

  return Result.gen(async function* () {
    const registry = yield* createPiModelRegistry({
      operation: "listModels",
      agentDir: options.agentDir,
    });
    const models = (
      input.includeUnavailable ? registry.getAll() : registry.getAvailable()
    ) as PiModel[];

    return Result.ok(
      sortModelInfos(models.map((model) => toHarnessModelInfo({ registry, model }))),
    );
  });
}

export async function getModel(
  runtime: PiRuntime,
  input: HarnessAdapterGetModelInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"pi">, PiPublicModelHandlerError>> {
  return mapPiModelSessionError({
    result: getEffectiveModel({ runtime, target: input.target }),
    target: input.target,
    operation: "getModel",
  });
}

export async function setModel(
  runtime: PiRuntime,
  input: HarnessAdapterSetModelInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"pi">, PiPublicModelHandlerError>> {
  const update = input.update;

  if (update.type === "clear") {
    if (input.target.type !== "harness") {
      return Result.err(
        new PiModelSelectionError({
          modelId: input.target.ref.sessionId,
          reason: "Pi does not support clearing a live session model; set another model instead",
        }),
      );
    }

    runtime.defaultModel = undefined;
    return mapPiModelSessionError({
      result: getEffectiveModel({ runtime, target: input.target }),
      target: input.target,
      operation: "setModel",
    });
  }

  const options = mergePiCreateOptions(runtime.config, input.adapterOptions);

  const selected = await Result.gen(async function* () {
    const registry = yield* input.target.type === "session"
      ? getLiveSessionModelRegistry(runtime, input.target.ref.sessionId)
      : createPiModelRegistry({ operation: "setModel", agentDir: options.agentDir });
    const model = yield* resolvePiModel({ registry, model: update.model });
    const selectedRef = toPiModelRef(model);

    if (input.target.type === "harness") {
      runtime.defaultModel = selectedRef;
      return Result.ok(
        toSelectedModel({ target: input.target, model: selectedRef, source: "harness" }),
      );
    }

    const handle = runtime.sessions.get(input.target.ref.sessionId);
    if (!handle) {
      return Result.err(new PiSessionNotFoundError({ sessionId: input.target.ref.sessionId }));
    }

    yield* Result.await(
      Result.tryPromise({
        try: () => handle.session.setModel(model),
        catch: (cause) => new PiSessionRequestError({ operation: "setModel", cause }),
      }),
    );

    return Result.ok(
      toSelectedModel({
        target: input.target,
        model: toPiModelRef(handle.session.model),
        source: "session",
      }),
    );
  });

  return mapPiModelSessionError({
    result: selected,
    target: input.target,
    operation: "setModel",
  });
}

function mapPiModelSessionError<TValue>(input: {
  readonly result: ResultType<TValue, PiModelHandlerError>;
  readonly target: HarnessModelTarget<"pi">;
  readonly operation: HarnessSessionOperation;
}): ResultType<TValue, PiPublicModelHandlerError> {
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
          new PiModelRequestError({ operation: input.operation, cause: input.result.error }),
        );
  }

  return Result.err(input.result.error);
}

function getLiveSessionModelRegistry(
  runtime: PiRuntime,
  sessionId: string,
): ResultType<ModelRegistry, PiSessionNotFoundError> {
  const handle = runtime.sessions.get(sessionId);
  return handle
    ? Result.ok(handle.session.modelRegistry)
    : Result.err(new PiSessionNotFoundError({ sessionId }));
}

export function toPiThinkingLevel(args: {
  readonly level: string;
}): ResultType<PiThinkingLevel, PiModelSelectionError> {
  return hasPiThinkingLevel(args.level)
    ? Result.ok(args.level)
    : Result.err(
        new PiModelSelectionError({
          modelId: `thinking:${args.level}`,
          reason: "Pi supports thinking levels off, minimal, low, medium, high, and xhigh",
        }),
      );
}
