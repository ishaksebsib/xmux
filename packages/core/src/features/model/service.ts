import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import { HarnessAdapterThinkingUnsupportedError } from "@xmux/harness-core";
import type {
  GetModelError,
  GetModelInput,
  GetThinkingError,
  GetThinkingInput,
  HarnessAdapterDefinitions,
  HarnessModelInfo,
  HarnessSelectedModel,
  HarnessSelectedThinking,
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
  | GetThinkingError
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
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
  readonly models: readonly HarnessModelInfo[];
  readonly maxModelsPerProvider: number;
}

export interface ModelShownOutput {
  readonly status: "shown";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedModel;
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
  readonly models: readonly HarnessModelInfo[];
  readonly providerGroups: readonly ModelProviderGroup[];
}

export interface ModelUpdatedOutput {
  readonly status: "updated";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedModel;
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
}

export interface ModelThinkingOutput {
  readonly status: "thinking";
  readonly session: SessionRecord;
  readonly model: HarnessModelInfo;
  readonly providerIndex: number;
  readonly modelIndex: number;
  readonly levels: readonly HarnessThinkingLevel[];
  readonly defaultLevel?: HarnessThinkingLevel;
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
}

export interface ModelProviderOutput {
  readonly status: "provider";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedModel;
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
  readonly provider: ModelProviderGroup;
  readonly providerIndex: number;
  readonly maxModelsPerProvider: number;
}

export interface ModelProviderGroup {
  readonly providerName: string;
  readonly models: HarnessModelInfo[];
}

interface ModelThinkingState {
  readonly thinkingSupported: boolean;
  readonly thinkingLevel?: HarnessThinkingLevel;
}

interface CurrentModelState extends ModelThinkingState {
  readonly current: HarnessSelectedModel;
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
      const currentState = yield* Result.await(
        getCurrentModelState({
          ctx: input.ctx,
          session,
          models: models as readonly HarnessModelInfo[],
        }),
      );

      return Result.ok({
        status: "shown" as const,
        session,
        ...currentState,
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
      setSessionModel({ ctx: input.ctx, session, model: resolved }),
    );
    const thinkingState = yield* Result.await(
      getThinkingStateForModel({ ctx: input.ctx, session, model: resolved }),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: selected as HarnessSelectedModel,
      ...thinkingState,
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
    const currentState = yield* Result.await(
      getCurrentModelState({
        ctx: input.ctx,
        session,
        models: models as readonly HarnessModelInfo[],
      }),
    );

    return Result.ok({
      status: "provider" as const,
      session,
      ...currentState,
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
        thinkingSupported: true,
        thinkingLevel: model.capabilities?.thinking?.defaultLevel,
      });
    }

    const selected = yield* Result.await(setSessionModel({ ctx: input.ctx, session, model }));
    const thinkingState = yield* Result.await(
      getThinkingStateForModel({ ctx: input.ctx, session, model }),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: selected as HarnessSelectedModel,
      ...thinkingState,
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

    const selected = yield* Result.await(setSessionModel({ ctx: input.ctx, session, model }));

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
    const thinkingState = yield* Result.await(
      getThinkingStateForModel({ ctx: input.ctx, session, model }),
    );

    return Result.ok({
      status: "updated" as const,
      session,
      selected: (current ?? selected) as HarnessSelectedModel,
      ...thinkingState,
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
    const currentState = yield* Result.await(
      getCurrentModelState({
        ctx: input.ctx,
        session,
        models: models as readonly HarnessModelInfo[],
      }),
    );

    return Result.ok({
      status: "available" as const,
      session,
      ...currentState,
      models: models as readonly HarnessModelInfo[],
      maxModelsPerProvider: input.ctx.app.config.model.maxModelsPerProvider,
    });
  });
}

function getCurrentModelState<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly models: readonly HarnessModelInfo[];
}): Promise<Result<CurrentModelState, GetModelError | GetThinkingError>> {
  return Result.gen(async function* () {
    const current = yield* Result.await(
      input.ctx.app.harness.getModel({
        target: { type: "session", ref: input.session.ref },
        signal: input.ctx.signal,
      } as GetModelInput<TAdapters>),
    );
    const currentModel = current as HarnessSelectedModel;
    const modelInfo = findModelInfo({
      models: input.models,
      model: currentModel.model,
    });
    const thinkingState = yield* Result.await(
      getThinkingStateForModel({
        ctx: input.ctx,
        session: input.session,
        model: modelInfo,
      }),
    );

    return Result.ok({
      current: currentModel,
      ...thinkingState,
    });
  });
}

async function getThinkingStateForModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly model?: HarnessModelInfo;
}): Promise<Result<ModelThinkingState, GetThinkingError>> {
  const thinking = await getSessionThinking(input);

  return Result.map(thinking, (thinking) => ({
    thinkingSupported: isThinkingSupportedForModel(input.model),
    thinkingLevel: formatThinkingLevelForModel({
      model: input.model,
      thinking,
    }),
  }));
}

function setSessionModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly model: HarnessModelInfo;
}): Promise<Result<HarnessSelectedModel, SetModelError | SetThinkingError>> {
  return Result.gen(async function* () {
    yield* Result.await(disableThinkingForUnsupportedModel(input));

    const selected = yield* Result.await(
      input.ctx.app.harness.setModel({
        target: { type: "session", ref: input.session.ref },
        update: { type: "set", model: input.model.ref },
        signal: input.ctx.signal,
      } as SetModelInput<TAdapters>),
    );

    return Result.ok(selected as HarnessSelectedModel);
  });
}

async function disableThinkingForUnsupportedModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly model: HarnessModelInfo;
}): Promise<Result<void, SetThinkingError>> {
  if (!isThinkingUnsupportedForModel(input.model.capabilities?.thinking?.supportedLevels)) {
    return Result.ok();
  }

  const updated = (await input.ctx.app.harness.setThinking({
    target: { type: "session", ref: input.session.ref },
    update: { type: "set", level: "off" },
    signal: input.ctx.signal,
  } as SetThinkingInput<TAdapters>)) as Result<HarnessSelectedThinking, SetThinkingError>;

  return Result.map(recoverUnsupportedSetThinking(updated), () => undefined);
}

async function getSessionThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessSelectedThinking, GetThinkingError>> {
  const target = { type: "session" as const, ref: input.session.ref };

  const thinking = (await input.ctx.app.harness.getThinking({
    target,
    signal: input.ctx.signal,
  } as GetThinkingInput<TAdapters>)) as Result<HarnessSelectedThinking, GetThinkingError>;

  return recoverUnsupportedThinking(thinking, target);
}

function recoverUnsupportedThinking(
  result: Result<HarnessSelectedThinking, GetThinkingError>,
  target: HarnessSelectedThinking["target"],
): Result<HarnessSelectedThinking, GetThinkingError> {
  return Result.match(result, {
    ok: (value) => Result.ok(value),
    err: (error): Result<HarnessSelectedThinking, GetThinkingError> => {
      if (HarnessAdapterThinkingUnsupportedError.is(error)) {
        return Result.ok({ target, source: "unset" });
      }
      return Result.err(error);
    },
  });
}

function recoverUnsupportedSetThinking(
  result: Result<HarnessSelectedThinking, SetThinkingError>,
): Result<HarnessSelectedThinking | undefined, SetThinkingError> {
  return Result.match(result, {
    ok: (value) => Result.ok(value),
    err: (error): Result<HarnessSelectedThinking | undefined, SetThinkingError> => {
      if (HarnessAdapterThinkingUnsupportedError.is(error)) return Result.ok(undefined);
      return Result.err(error);
    },
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

function isThinkingSupportedForModel(model: HarnessModelInfo | undefined): boolean {
  return model !== undefined && configurableThinkingLevels(model).length > 0;
}

function formatThinkingLevelForModel(input: {
  readonly model?: HarnessModelInfo;
  readonly thinking: HarnessSelectedThinking;
}): HarnessThinkingLevel | undefined {
  return isThinkingSupportedForModel(input.model) ? input.thinking.level : undefined;
}

function isThinkingUnsupportedForModel(
  levels: readonly HarnessThinkingLevel[] | undefined,
): boolean {
  return levels !== undefined && levels.every((level) => level === "off");
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

function findModelInfo(input: {
  readonly models: readonly HarnessModelInfo[];
  readonly model?: HarnessSelectedModel["model"];
}): HarnessModelInfo | undefined {
  return input.model === undefined
    ? undefined
    : input.models.find((model) => isSameBaseModel(model.ref, input.model));
}

function isSameBaseModel(
  left: HarnessSelectedModel["model"],
  right: HarnessSelectedModel["model"],
) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
  );
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
