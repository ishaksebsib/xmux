import type { Session } from "@opencode-ai/sdk/v2";
import type {
  HarnessAdapterGetModelInput,
  HarnessAdapterListModelsInput,
  HarnessAdapterSetModelInput,
  HarnessModelInfo,
  HarnessModelRef,
  HarnessModelTarget,
  HarnessSelectedModel,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  OpenCodeModelRequestError,
  OpenCodeModelResponseError,
  OpenCodeModelSelectionError,
} from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import type { OpenCodeCreateOptions, OpenCodeModelInfo } from "../types";
import { describeResponseError, toResponseResult, toSessionModel } from "./utils";
import { applyThinkingToModel, supportedThinkingLevelsForModel } from "./thinking";

type OpenCodeModelRef = {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
};

type OpenCodeModelError =
  | OpenCodeModelRequestError
  | OpenCodeModelResponseError
  | OpenCodeModelSelectionError;

type SupportedMediaKind = "text" | "image" | "audio" | "video" | "pdf";

const supportedMediaKinds = new Set<string>(["text", "image", "audio", "video", "pdf"]);

function isSupportedMediaKind(value: string): value is SupportedMediaKind {
  return supportedMediaKinds.has(value);
}

function toSupportedMediaKinds(values: Readonly<Record<string, boolean>>): SupportedMediaKind[] {
  return Object.entries(values)
    .filter(([_, supported]) => supported)
    .map(([kind]) => kind)
    .filter(isSupportedMediaKind);
}

function toModelStatus(model: OpenCodeModelInfo["model"]): HarnessModelInfo["status"] {
  return model.status === "alpha" ? "beta" : model.status;
}

function toModelCost(model: OpenCodeModelInfo["model"]): HarnessModelInfo["cost"] {
  return {
    input: model.cost.input,
    output: model.cost.output,
    cacheRead: model.cost.cache.read,
    cacheWrite: model.cost.cache.write,
  };
}

function toHarnessModelInfo(args: {
  readonly runtime: OpenCodeRuntime;
  readonly provider: OpenCodeModelInfo["provider"];
  readonly model: OpenCodeModelInfo["model"];
}): HarnessModelInfo<"opencode", OpenCodeModelInfo> {
  const supportedThinkingLevels = supportedThinkingLevelsForModel({
    runtime: args.runtime,
    model: args.model,
  });
  return {
    harnessId: "opencode",
    ref: {
      providerId: args.model.providerID,
      modelId: args.model.id,
    },
    name: args.model.name,
    providerName: args.provider.name,
    status: toModelStatus(args.model),
    available: true,
    capabilities: {
      tools: args.model.capabilities.toolcall,
      reasoning: args.model.capabilities.reasoning,
      thinking: {
        supportedLevels: supportedThinkingLevels,
        defaultLevel: supportedThinkingLevels.includes("medium")
          ? "medium"
          : supportedThinkingLevels[0],
      },
      temperature: args.model.capabilities.temperature,
      input: toSupportedMediaKinds(args.model.capabilities.input),
      output: toSupportedMediaKinds(args.model.capabilities.output),
    },
    limits: {
      context: args.model.limit.context,
      input: args.model.limit.input,
      output: args.model.limit.output,
    },
    cost: toModelCost(args.model),
    adapterData: {
      provider: args.provider,
      model: args.model,
    },
  };
}

function releaseTime(model: OpenCodeModelInfo["model"]): number {
  const time = Date.parse(model.release_date);
  return Number.isFinite(time) ? time : 0;
}

function sortModelsByNewestFirst(
  models: readonly OpenCodeModelInfo["model"][],
): OpenCodeModelInfo["model"][] {
  return [...models].sort((left, right) => {
    const byReleaseDate = releaseTime(right) - releaseTime(left);
    return byReleaseDate === 0 ? left.name.localeCompare(right.name) : byReleaseDate;
  });
}

function toModelResponseError(args: {
  readonly status: number;
  readonly detail?: unknown;
  readonly reason: string;
}): OpenCodeModelResponseError {
  return new OpenCodeModelResponseError({
    status: args.status,
    detail: args.detail === undefined ? undefined : describeResponseError(args.detail),
    reason: args.reason,
  });
}

export function normalizeOpenCodeModelRef(
  model: HarnessModelRef,
): ResultType<OpenCodeModelRef, OpenCodeModelSelectionError> {
  if (!model.providerId) {
    return Result.err(
      new OpenCodeModelSelectionError({
        modelId: model.modelId,
        reason: "providerId is required",
      }),
    );
  }

  return Result.ok({
    providerID: model.providerId,
    modelID: model.modelId,
    variant: model.variant,
  });
}

export function getEffectiveModel(args: {
  readonly runtime: OpenCodeRuntime;
  readonly target: HarnessModelTarget<"opencode">;
}): HarnessSelectedModel<"opencode"> {
  if (args.target.type === "harness") {
    return args.runtime.defaultModel
      ? { target: args.target, model: args.runtime.defaultModel, source: "harness" }
      : { target: args.target, source: "unset" };
  }

  const sessionModel = args.runtime.sessionModels.get(args.target.ref.sessionId);
  if (sessionModel) {
    return { target: args.target, model: sessionModel, source: "session" };
  }

  return args.runtime.defaultModel
    ? { target: args.target, model: args.runtime.defaultModel, source: "harness" }
    : { target: args.target, source: "unset" };
}

export function getEffectiveSessionModel(args: {
  readonly runtime: OpenCodeRuntime;
  readonly session: Session;
}): HarnessModelRef | undefined {
  return (
    args.runtime.sessionModels.get(args.session.id) ??
    toSessionModel(args.session) ??
    args.runtime.defaultModel
  );
}

export async function listModels(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterListModelsInput<OpenCodeCreateOptions>,
): Promise<
  ResultType<readonly HarnessModelInfo<"opencode", OpenCodeModelInfo>[], OpenCodeModelError>
> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          runtime.client.config.providers(
            {
              directory: input.cwd,
              workspace: input.adapterOptions.workspace,
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeModelRequestError({ cause }),
      }),
    );

    const data = yield* toResponseResult({
      response,
      toError: toModelResponseError,
      failureReason: "OpenCode model list failed",
      missingReason: "OpenCode model list returned no data",
    });

    return Result.ok(
      data.providers.flatMap((provider) =>
        sortModelsByNewestFirst(
          Object.values(provider.models).filter(
            (model) => input.includeUnavailable || model.status !== "deprecated",
          ),
        ).map((model) => toHarnessModelInfo({ runtime, provider, model })),
      ),
    );
  });
}

export async function getModel(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterGetModelInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"opencode">, never>> {
  return Result.ok(getEffectiveModel({ runtime, target: input.target }));
}

export async function setModel(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterSetModelInput<"opencode", OpenCodeCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"opencode">, OpenCodeModelSelectionError>> {
  if (input.update.type === "set") {
    const update = input.update;
    return Result.gen(async function* () {
      const thinking =
        input.target.type === "harness"
          ? runtime.defaultThinking
          : (runtime.sessionThinking?.get(input.target.ref.sessionId) ?? runtime.defaultThinking);
      const selectedModel = yield* applyThinkingToModel({
        runtime,
        model: update.model,
        level: thinking,
      });

      const model = selectedModel ?? update.model;
      yield* normalizeOpenCodeModelRef(model);

      if (input.target.type === "harness") {
        runtime.defaultModel = model;
      } else {
        runtime.sessionModels.set(input.target.ref.sessionId, model);
      }

      return Result.ok(getEffectiveModel({ runtime, target: input.target }));
    });
  }

  if (input.target.type === "harness") {
    runtime.defaultModel = undefined;
  } else {
    runtime.sessionModels.delete(input.target.ref.sessionId);
  }

  return Result.ok(getEffectiveModel({ runtime, target: input.target }));
}
