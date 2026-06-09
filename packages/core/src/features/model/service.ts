import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  GetModelError,
  GetModelInput,
  HarnessAdapterDefinitions,
  HarnessModelInfo,
  HarnessSelectedModel,
  HarnessThinkingLevel,
  ListModelsError,
  ListModelsInput,
  SetModelError,
  SetModelInput,
  SetThinkingError,
  SetThinkingInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import type {
  NoActiveSessionError,
  SessionClosedError,
  SessionRecordMissingError,
} from "../errors";
import { ModelActionPayloadInvalidError } from "./errors";
import { resolveModelSelector, type ResolveModelSelectorError } from "./selector";
import {
  ThinkingLevelUnsupportedError,
  ThinkingModelThinkingUnsupportedError,
} from "../thinking/errors";
import { getActiveSessionForThread } from "../session";

export type ModelCommandError =
  | StoreError
  | ListModelsError
  | GetModelError
  | SetModelError
  | SetThinkingError
  | ResolveModelSelectorError
  | ModelActionPayloadInvalidError
  | ThinkingLevelUnsupportedError
  | ThinkingModelThinkingUnsupportedError
  | NoActiveSessionError
  | SessionRecordMissingError
  | SessionClosedError;

export type ModelCommandOutput = ModelShownOutput | ModelUpdatedOutput;

export interface ModelAvailableOutput {
  readonly status: "available";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedModel;
  readonly models: readonly HarnessModelInfo[];
  readonly maxModelsPerProvider: number;
}

export interface ModelShownOutput {
  readonly status: "shown";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedModel;
  readonly models: readonly HarnessModelInfo[];
  readonly providerGroups: readonly ModelProviderGroup[];
}

export interface ModelUpdatedOutput {
  readonly status: "updated";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedModel;
}

export interface ModelThinkingOutput {
  readonly status: "thinking";
  readonly session: SessionRecord;
  readonly model: HarnessModelInfo;
  readonly providerIndex: number;
  readonly modelIndex: number;
  readonly levels: readonly HarnessThinkingLevel[];
  readonly defaultLevel?: HarnessThinkingLevel;
}

export interface ModelProviderOutput {
  readonly status: "provider";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedModel;
  readonly provider: ModelProviderGroup;
  readonly providerIndex: number;
  readonly maxModelsPerProvider: number;
}

export interface ModelProviderGroup {
  readonly providerName: string;
  readonly models: HarnessModelInfo[];
}

export interface ModelSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly selector?: string;
}

export async function modelSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ModelSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ModelCommandOutput, ModelCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));

    const selector = input.selector?.trim();

    if (!selector) {
      const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));
      const current = yield* Result.await(
        input.ctx.app.harness.getModel({
          target: { type: "session", ref: session.ref },
          signal: input.ctx.signal,
        } as GetModelInput<TAdapters>),
      );

      return Result.ok({
        status: "shown" as const,
        session,
        current: current as HarnessSelectedModel,
        models: models as readonly HarnessModelInfo[],
        providerGroups: groupModelsByProvider(models as readonly HarnessModelInfo[]),
      });
    }

    const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));

    const resolved = yield* resolveModelSelector({
      selector,
      models: models as readonly HarnessModelInfo[],
    });

    const selected = yield* Result.await(
      input.ctx.app.harness.setModel({
        target: { type: "session", ref: session.ref },
        update: { type: "set", model: resolved.ref },
        signal: input.ctx.signal,
      } as SetModelInput<TAdapters>),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: selected as HarnessSelectedModel,
    });
  });
}

export async function modelProviderCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly providerIndex: number;
}): Promise<Result<ModelProviderOutput, ModelCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));
    const providerGroups = groupModelsByProvider(models as readonly HarnessModelInfo[]);
    const provider = yield* requireProviderGroup({
      providerGroups,
      providerIndex: input.providerIndex,
    });
    const current = yield* Result.await(
      input.ctx.app.harness.getModel({
        target: { type: "session", ref: session.ref },
        signal: input.ctx.signal,
      } as GetModelInput<TAdapters>),
    );

    return Result.ok({
      status: "provider" as const,
      session,
      current: current as HarnessSelectedModel,
      provider,
      providerIndex: input.providerIndex,
      maxModelsPerProvider: input.ctx.app.config.model.maxModelsPerProvider,
    });
  });
}

export async function modelActionSetCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly providerIndex: number;
  readonly modelIndex: number;
}): Promise<Result<ModelUpdatedOutput | ModelThinkingOutput, ModelCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));
    const providerGroups = groupModelsByProvider(models as readonly HarnessModelInfo[]);
    const provider = yield* requireProviderGroup({
      providerGroups,
      providerIndex: input.providerIndex,
    });
    const model = yield* requireModelInfo({
      provider,
      providerIndex: input.providerIndex,
      modelIndex: input.modelIndex,
    });

    const levels = configurableThinkingLevels(model);
    if (levels.length > 0) {
      return Result.ok({
        status: "thinking" as const,
        session,
        model,
        providerIndex: input.providerIndex,
        modelIndex: input.modelIndex,
        levels,
        defaultLevel: model.capabilities?.thinking?.defaultLevel,
      });
    }

    const selected = yield* Result.await(
      input.ctx.app.harness.setModel({
        target: { type: "session", ref: session.ref },
        update: { type: "set", model: model.ref },
        signal: input.ctx.signal,
      } as SetModelInput<TAdapters>),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: selected as HarnessSelectedModel,
    });
  });
}

export async function modelActionSetThinkingCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly providerIndex: number;
  readonly modelIndex: number;
  readonly level: HarnessThinkingLevel;
}): Promise<Result<ModelUpdatedOutput, ModelCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));
    const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));
    const providerGroups = groupModelsByProvider(models as readonly HarnessModelInfo[]);
    const provider = yield* requireProviderGroup({
      providerGroups,
      providerIndex: input.providerIndex,
    });
    const model = yield* requireModelInfo({
      provider,
      providerIndex: input.providerIndex,
      modelIndex: input.modelIndex,
    });
    const levels = configurableThinkingLevels(model);

    if (levels.length === 0) {
      return Result.err(new ThinkingModelThinkingUnsupportedError({ model: model.ref }));
    }

    yield* ensureSupportedThinkingLevel({ levels, level: input.level });

    const selected = yield* Result.await(
      input.ctx.app.harness.setModel({
        target: { type: "session", ref: session.ref },
        update: { type: "set", model: model.ref },
        signal: input.ctx.signal,
      } as SetModelInput<TAdapters>),
    );

    yield* Result.await(
      input.ctx.app.harness.setThinking({
        target: { type: "session", ref: session.ref },
        update: { type: "set", level: input.level },
        signal: input.ctx.signal,
      } as SetThinkingInput<TAdapters>),
    );

    const current = yield* Result.await(
      input.ctx.app.harness.getModel({
        target: { type: "session", ref: session.ref },
        signal: input.ctx.signal,
      } as GetModelInput<TAdapters>),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: (current ?? selected) as HarnessSelectedModel,
    });
  });
}

export async function modelAvailableCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: Omit<ModelSessionCommandInput<TAdapters, TChats>, "selector">,
): Promise<Result<ModelAvailableOutput, ModelCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));

    const models = yield* Result.await(listSessionModels({ ctx: input.ctx, session }));

    const current = yield* Result.await(
      input.ctx.app.harness.getModel({
        target: { type: "session", ref: session.ref },
        signal: input.ctx.signal,
      } as GetModelInput<TAdapters>),
    );

    return Result.ok({
      status: "available" as const,
      session,
      current: current as HarnessSelectedModel,
      models: models as readonly HarnessModelInfo[],
      maxModelsPerProvider: input.ctx.app.config.model.maxModelsPerProvider,
    });
  });
}

function listSessionModels<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<readonly HarnessModelInfo[], ListModelsError>> {
  return input.ctx.app.harness.listModels({
    harnessId: input.session.ref.harnessId,
    cwd: input.session.cwd,
    signal: input.ctx.signal,
  } as ListModelsInput<TAdapters>) as Promise<Result<readonly HarnessModelInfo[], ListModelsError>>;
}

function configurableThinkingLevels(model: HarnessModelInfo): readonly HarnessThinkingLevel[] {
  const levels = model.capabilities?.thinking?.supportedLevels ?? [];
  return levels.some((level) => level !== "off") ? levels : [];
}

function ensureSupportedThinkingLevel(input: {
  readonly levels: readonly HarnessThinkingLevel[];
  readonly level: HarnessThinkingLevel;
}): Result<void, ThinkingLevelUnsupportedError> {
  if (input.levels.includes(input.level)) return Result.ok();

  return Result.err(
    new ThinkingLevelUnsupportedError({
      level: input.level,
      supportedLevels: input.levels,
    }),
  );
}

export function groupModelsByProvider(
  models: readonly HarnessModelInfo[],
): readonly ModelProviderGroup[] {
  const groups: ModelProviderGroup[] = [];

  for (const model of models) {
    const providerName = modelProviderName(model);
    const group = groups.find((candidate) => candidate.providerName === providerName);

    if (group) {
      group.models.push(model);
      continue;
    }

    groups.push({ providerName, models: [model] });
  }

  return groups;
}

function modelProviderName(model: HarnessModelInfo): string {
  const reportedName = model.providerName?.trim();
  if (reportedName) return reportedName;

  const providerId = model.ref.providerId?.trim();
  return providerId && providerId.length > 0 ? providerId : "Other";
}

function requireProviderGroup(input: {
  readonly providerGroups: readonly ModelProviderGroup[];
  readonly providerIndex: number;
}): Result<ModelProviderGroup, ModelActionPayloadInvalidError> {
  const provider = input.providerGroups[input.providerIndex];

  return provider === undefined
    ? Result.err(
        new ModelActionPayloadInvalidError({
          payload: String(input.providerIndex),
          reason: "provider selection is no longer available",
        }),
      )
    : Result.ok(provider);
}

function requireModelInfo(input: {
  readonly provider: ModelProviderGroup;
  readonly providerIndex: number;
  readonly modelIndex: number;
}): Result<HarnessModelInfo, ModelActionPayloadInvalidError> {
  const model = input.provider.models[input.modelIndex];

  return model === undefined
    ? Result.err(
        new ModelActionPayloadInvalidError({
          payload: `${input.providerIndex}:${input.modelIndex}`,
          reason: "model selection is no longer available",
        }),
      )
    : Result.ok(model);
}
