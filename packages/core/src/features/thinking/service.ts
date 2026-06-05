import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  GetModelError,
  GetModelInput,
  GetThinkingError,
  GetThinkingInput,
  HarnessAdapterDefinitions,
  HarnessModelInfo,
  HarnessModelRef,
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
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  ThinkingLevelInvalidError,
  ThinkingLevelUnsupportedError,
  ThinkingModelThinkingUnsupportedError,
  ThinkingModelUnsetError,
  ThinkingNoActiveSessionError,
  ThinkingSessionClosedError,
  ThinkingSessionRecordMissingError,
} from "./errors";
import { parseThinkingSelector } from "./selector";

export type ThinkingCommandError =
  | StoreError
  | GetModelError
  | GetThinkingError
  | ListModelsError
  | SetThinkingError
  | ThinkingLevelInvalidError
  | ThinkingLevelUnsupportedError
  | ThinkingModelThinkingUnsupportedError
  | ThinkingModelUnsetError
  | ThinkingNoActiveSessionError
  | ThinkingSessionRecordMissingError
  | ThinkingSessionClosedError;

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

/** Shows or updates the thinking level for the active session bound to a chat thread. */
export async function thinkingSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ThinkingSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ThinkingCommandOutput, ThinkingCommandError>> {
  const session = await getThinkingSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const parsed = parseThinkingSelector(input.level);

  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  const model = await getSessionModel({ ctx: input.ctx, session: session.value });

  if (model.isErr()) {
    return Result.err(model.error);
  }

  const current = await getSessionThinking({ ctx: input.ctx, session: session.value });

  if (current.isErr()) {
    return Result.err(current.error);
  }

  const thinking = await enrichThinkingWithModelCapabilities({
    ctx: input.ctx,
    session: session.value,
    current: current.value,
    model: model.value,
  });

  if (thinking.isErr()) {
    return Result.err(thinking.error);
  }

  if (isThinkingUnsupportedForModel(thinking.value.supportedLevels)) {
    return Result.err(new ThinkingModelThinkingUnsupportedError({ model: model.value }));
  }

  if (parsed.value.type === "show") {
    return Result.ok({ status: "shown", session: session.value, current: thinking.value });
  }

  if (parsed.value.type === "set") {
    const supported = ensureSupportedThinkingLevel({
      supportedLevels: thinking.value.supportedLevels,
      level: parsed.value.level,
    });

    if (supported.isErr()) {
      return Result.err(supported.error);
    }
  }

  const selected = await input.ctx.app.harness.setThinking({
    target: { type: "session", ref: session.value.ref },
    update:
      parsed.value.type === "clear"
        ? { type: "clear" }
        : { type: "set", level: parsed.value.level },
    signal: input.ctx.signal,
  } as SetThinkingInput<TAdapters>);

  if (selected.isErr()) {
    return Result.err(selected.error);
  }

  const selectedThinking = selected.value as HarnessSelectedThinking;
  const selectedWithSupportedLevels =
    selectedThinking.supportedLevels === undefined && thinking.value.supportedLevels !== undefined
      ? { ...selectedThinking, supportedLevels: thinking.value.supportedLevels }
      : selectedThinking;

  return Result.ok({
    status: parsed.value.type === "clear" ? "cleared" : "updated",
    session: session.value,
    selected: selectedWithSupportedLevels,
  });
}

interface GetThinkingSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

async function getThinkingSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: GetThinkingSessionForThreadInput<TAdapters, TChats>,
): Promise<
  Result<
    SessionRecord,
    | StoreError
    | ThinkingNoActiveSessionError
    | ThinkingSessionRecordMissingError
    | ThinkingSessionClosedError
  >
> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.err(new ThinkingNoActiveSessionError({ thread: input.thread }));
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  if (!session.value) {
    return Result.err(
      new ThinkingSessionRecordMissingError({ sessionRef: binding.value.sessionRef }),
    );
  }

  if (session.value.status !== "open") {
    return Result.err(new ThinkingSessionClosedError({ sessionRef: session.value.ref }));
  }

  return Result.ok(session.value);
}

async function getSessionThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessSelectedThinking, GetThinkingError>> {
  const current = await input.ctx.app.harness.getThinking({
    target: { type: "session", ref: input.session.ref },
    signal: input.ctx.signal,
  } as GetThinkingInput<TAdapters>);

  return current.isErr()
    ? Result.err(current.error)
    : Result.ok(current.value as HarnessSelectedThinking);
}

async function getSessionModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessModelRef | undefined, GetModelError | ThinkingModelUnsetError>> {
  const selected = await input.ctx.app.harness.getModel({
    target: { type: "session", ref: input.session.ref },
    signal: input.ctx.signal,
  } as GetModelInput<TAdapters>);

  if (selected.isErr()) {
    if (HarnessAdapterModelUnsupportedError.is(selected.error)) {
      return Result.ok(undefined);
    }

    return Result.err(selected.error);
  }

  return selected.value.model === undefined
    ? Result.err(new ThinkingModelUnsetError({ sessionRef: input.session.ref }))
    : Result.ok(selected.value.model);
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

  const models = await input.ctx.app.harness.listModels({
    harnessId: input.session.ref.harnessId,
    cwd: input.session.cwd,
    signal: input.ctx.signal,
  } as ListModelsInput<TAdapters>);

  if (models.isErr()) {
    if (HarnessAdapterModelUnsupportedError.is(models.error)) {
      return Result.ok(input.current);
    }

    return Result.err(models.error);
  }

  const model = findModelInfo({
    model: input.model,
    models: models.value as readonly HarnessModelInfo[],
  });
  const supportedLevels = model?.capabilities?.thinking?.supportedLevels;

  return supportedLevels === undefined
    ? Result.ok(input.current)
    : Result.ok({ ...input.current, supportedLevels });
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

function isSameModel(left: HarnessModelRef, right: HarnessModelRef): boolean {
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant
  );
}
