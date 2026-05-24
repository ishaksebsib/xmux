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
import { describeResponseError, type OpenCodeCreateOptions, type OpenCodeModelInfo } from "./utils";

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

function toSupportedMediaKinds(values: readonly string[]): SupportedMediaKind[] {
  return values.filter(isSupportedMediaKind);
}

function toModelStatus(model: OpenCodeModelInfo["model"]): HarnessModelInfo["status"] {
  if (!model.enabled) return "unavailable";
  return model.status === "alpha" ? "beta" : model.status;
}

function toModelCost(model: OpenCodeModelInfo["model"]): HarnessModelInfo["cost"] {
  const cost = model.cost.find((candidate) => candidate.tier === undefined) ?? model.cost[0];
  if (!cost) return undefined;

  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache.read,
    cacheWrite: cost.cache.write,
  };
}

function toHarnessModelInfo(args: {
  readonly model: OpenCodeModelInfo["model"];
  readonly variant?: OpenCodeModelInfo["variant"];
}): HarnessModelInfo<"opencode", OpenCodeModelInfo> {
  return {
    harnessId: "opencode",
    ref: {
      providerId: args.model.providerID,
      modelId: args.model.id,
      variant: args.variant?.id,
    },
    name: args.variant ? `${args.model.name} (${args.variant.id})` : args.model.name,
    status: toModelStatus(args.model),
    available: args.model.enabled,
    capabilities: {
      tools: args.model.capabilities.tools,
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
      model: args.model,
      variant: args.variant,
    },
  };
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
          runtime.client.v2.model.list(
            {
              location: {
                directory: input.cwd,
                workspace: input.adapterOptions.workspace,
              },
            },
            { signal: input.signal },
          ),
        catch: (cause) => new OpenCodeModelRequestError({ cause }),
      }),
    );

    const status = response.response?.status ?? 0;

    if (response.error) {
      return Result.err(
        toModelResponseError({
          status,
          detail: response.error,
          reason: "OpenCode model list failed",
        }),
      );
    }

    if (!response.data) {
      return Result.err(
        toModelResponseError({
          status,
          reason: "OpenCode model list returned no data",
        }),
      );
    }

    const models = input.includeUnavailable
      ? response.data
      : response.data.filter((model) => model.enabled);

    return Result.ok(
      models.flatMap((model) => [
        toHarnessModelInfo({ model }),
        ...model.variants.map((variant) => toHarnessModelInfo({ model, variant })),
      ]),
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
    const normalized = normalizeOpenCodeModelRef(input.update.model);
    if (normalized.isErr()) return Result.err(normalized.error);

    if (input.target.type === "harness") {
      runtime.defaultModel = input.update.model;
    } else {
      runtime.sessionModels.set(input.target.ref.sessionId, input.update.model);
    }

    return Result.ok(getEffectiveModel({ runtime, target: input.target }));
  }

  if (input.target.type === "harness") {
    runtime.defaultModel = undefined;
  } else {
    runtime.sessionModels.delete(input.target.ref.sessionId);
  }

  return Result.ok(getEffectiveModel({ runtime, target: input.target }));
}
