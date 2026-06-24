import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  GetModelError,
  GetModelInput,
  GetThinkingError,
  GetThinkingInput,
  HarnessAdapterDefinitions,
  HarnessModelInfo,
  HarnessModelRef,
  HarnessSelectedModel,
  HarnessSelectedThinking,
  HarnessThinkingLevel,
  ListModelsError,
  ListModelsInput,
  SetThinkingError,
  SetThinkingInput,
} from "@xmux/harness-core";
import { HarnessAdapterModelUnsupportedError } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { isSameModel } from "../utils";
import {
  ThinkingLevelInvalidError,
  ThinkingLevelUnsupportedError,
  ThinkingModelThinkingUnsupportedError,
  ThinkingModelUnsetError,
} from "./errors";
import { parseThinkingSelector } from "./selector";
import { getActiveSessionForThread, type ActiveSessionError } from "../session";

export type ThinkingCommandError =
  | ActiveSessionError
  | GetModelError
  | GetThinkingError
  | ListModelsError
  | SetThinkingError
  | ThinkingLevelInvalidError
  | ThinkingLevelUnsupportedError
  | ThinkingModelThinkingUnsupportedError
  | ThinkingModelUnsetError;

export type ThinkingCommandOutput =
  | ThinkingShownOutput
  | ThinkingUpdatedOutput
  | ThinkingClearedOutput;

export interface ThinkingShownOutput {
  readonly status: "shown";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedThinking;
}

export interface ThinkingUpdatedOutput {
  readonly status: "updated";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedThinking;
}

export interface ThinkingClearedOutput {
  readonly status: "cleared";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedThinking;
}

export interface ThinkingSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly level?: string;
}

export async function thinkingSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ThinkingSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ThinkingCommandOutput, ThinkingCommandError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));

    const parsed = yield* parseThinkingSelector(input.level);

    const model = yield* Result.await(getSessionModel({ ctx: input.ctx, session }));

    const current = yield* Result.await(getSessionThinking({ ctx: input.ctx, session }));

    const thinking = yield* Result.await(
      enrichThinkingWithModelCapabilities({
        ctx: input.ctx,
        session,
        current,
        model,
      }),
    );

    if (isThinkingUnsupportedForModel(thinking.supportedLevels)) {
      return Result.err(new ThinkingModelThinkingUnsupportedError({ model }));
    }

    if (parsed.type === "show") {
      return Result.ok({ status: "shown" as const, session, current: thinking });
    }

    if (parsed.type === "set") {
      yield* ensureSupportedThinkingLevel({
        supportedLevels: thinking.supportedLevels,
        level: parsed.level,
      });
    }

    const selected = yield* Result.await(
      input.ctx.app.harness.setThinking({
        target: { type: "session", ref: session.ref },
        update: parsed.type === "clear" ? { type: "clear" } : { type: "set", level: parsed.level },
        signal: input.ctx.signal,
      } as SetThinkingInput<TAdapters>),
    );

    const selectedThinking = selected as HarnessSelectedThinking;
    const selectedWithSupportedLevels =
      selectedThinking.supportedLevels === undefined && thinking.supportedLevels !== undefined
        ? { ...selectedThinking, supportedLevels: thinking.supportedLevels }
        : selectedThinking;

    return Result.ok({
      status: (parsed.type === "clear" ? "cleared" : "updated") as "cleared" | "updated",
      session,
      selected: selectedWithSupportedLevels,
    });
  });
}

async function getSessionThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessSelectedThinking, GetThinkingError>> {
  return Result.gen(async function* () {
    const current = yield* Result.await(
      input.ctx.app.harness.getThinking({
        target: { type: "session", ref: input.session.ref },
        signal: input.ctx.signal,
      } as GetThinkingInput<TAdapters>),
    );

    return Result.ok(current as HarnessSelectedThinking);
  });
}

async function getSessionModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessModelRef | undefined, GetModelError | ThinkingModelUnsetError>> {
  return Result.gen(async function* () {
    const selected = yield* recoverUnsupportedModelManagement(
      (await input.ctx.app.harness.getModel({
        target: { type: "session", ref: input.session.ref },
        signal: input.ctx.signal,
      } as GetModelInput<TAdapters>)) as Result<HarnessSelectedModel | undefined, GetModelError>,
    );

    if (selected === undefined) return Result.ok(undefined);

    return selected.model === undefined
      ? Result.err(new ThinkingModelUnsetError({ sessionRef: input.session.ref }))
      : Result.ok(selected.model);
  });
}

async function enrichThinkingWithModelCapabilities<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly current: HarnessSelectedThinking;
  readonly model?: HarnessModelRef;
}): Promise<Result<HarnessSelectedThinking, ListModelsError>> {
  if (input.current.supportedLevels !== undefined || input.model === undefined) {
    return Result.ok(input.current);
  }

  const modelRef: HarnessModelRef = input.model;

  return Result.gen(async function* () {
    const models = yield* recoverUnsupportedListModels(
      (await input.ctx.app.harness.listModels({
        harnessId: input.session.ref.harnessId,
        cwd: input.session.cwd,
        signal: input.ctx.signal,
      } as ListModelsInput<TAdapters>)) as Result<
        readonly HarnessModelInfo[] | undefined,
        ListModelsError
      >,
    );

    if (models === undefined) return Result.ok(input.current);

    const model = findModelInfo({
      model: modelRef,
      models,
    });
    const supportedLevels = model?.capabilities?.thinking?.supportedLevels;

    return supportedLevels === undefined
      ? Result.ok(input.current)
      : Result.ok({ ...input.current, supportedLevels });
  });
}

function recoverUnsupportedModelManagement(
  result: Result<HarnessSelectedModel | undefined, GetModelError>,
): Result<HarnessSelectedModel | undefined, GetModelError> {
  return Result.match(result, {
    ok: (value) => Result.ok(value),
    err: (error): Result<HarnessSelectedModel | undefined, GetModelError> => {
      if (HarnessAdapterModelUnsupportedError.is(error)) return Result.ok(undefined);
      return Result.err(error);
    },
  });
}

function recoverUnsupportedListModels(
  result: Result<readonly HarnessModelInfo[] | undefined, ListModelsError>,
): Result<readonly HarnessModelInfo[] | undefined, ListModelsError> {
  return Result.match(result, {
    ok: (value) => Result.ok(value),
    err: (error): Result<readonly HarnessModelInfo[] | undefined, ListModelsError> => {
      if (HarnessAdapterModelUnsupportedError.is(error)) return Result.ok(undefined);
      return Result.err(error);
    },
  });
}

function ensureSupportedThinkingLevel(input: {
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly level: HarnessThinkingLevel;
}): Result<void, ThinkingLevelUnsupportedError> {
  if (input.supportedLevels === undefined || input.supportedLevels.includes(input.level)) {
    return Result.ok();
  }

  return Result.err(
    new ThinkingLevelUnsupportedError({
      level: input.level,
      supportedLevels: input.supportedLevels,
    }),
  );
}

function isThinkingUnsupportedForModel(
  supportedLevels: readonly HarnessThinkingLevel[] | undefined,
): boolean {
  return supportedLevels !== undefined && supportedLevels.every((level) => level === "off");
}

function findModelInfo(input: {
  readonly model: HarnessModelRef;
  readonly models: readonly HarnessModelInfo[];
}): HarnessModelInfo | undefined {
  return input.models.find((model) => isSameModel(model.ref, input.model));
}
