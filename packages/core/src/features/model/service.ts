import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  GetModelError,
  GetModelInput,
  HarnessAdapterDefinitions,
  HarnessModelInfo,
  HarnessSelectedModel,
  ListModelsError,
  ListModelsInput,
  SetModelError,
  SetModelInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  ModelNoActiveSessionError,
  ModelSessionClosedError,
  ModelSessionRecordMissingError,
} from "./errors";
import { resolveModelSelector, type ResolveModelSelectorError } from "./selector";

export type ModelCommandError =
  | StoreError
  | ListModelsError
  | GetModelError
  | SetModelError
  | ResolveModelSelectorError
  | ModelNoActiveSessionError
  | ModelSessionRecordMissingError
  | ModelSessionClosedError;

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
}

export interface ModelUpdatedOutput {
  readonly status: "updated";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedModel;
}

export interface ModelSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly selector?: string;
}

/** Shows or updates the model for the active session bound to a chat thread. */
export async function modelSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ModelSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ModelCommandOutput, ModelCommandError>> {
  const session = await getModelSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const selector = input.selector?.trim();

  if (!selector) {
    const current = await input.ctx.app.harness.getModel({
      target: { type: "session", ref: session.value.ref },
      signal: input.ctx.signal,
    } as GetModelInput<TAdapters>);

    if (current.isErr()) {
      return Result.err(current.error);
    }

    return Result.ok({
      status: "shown",
      session: session.value,
      current: current.value as HarnessSelectedModel,
    });
  }

  const models = await listSessionModels({ ctx: input.ctx, session: session.value });

  if (models.isErr()) {
    return Result.err(models.error);
  }

  const resolved = resolveModelSelector({
    selector,
    models: models.value as readonly HarnessModelInfo[],
  });

  if (resolved.isErr()) {
    return Result.err(resolved.error);
  }

  const selected = await input.ctx.app.harness.setModel({
    target: { type: "session", ref: session.value.ref },
    update: { type: "set", model: resolved.value.ref },
    signal: input.ctx.signal,
  } as SetModelInput<TAdapters>);

  if (selected.isErr()) {
    return Result.err(selected.error);
  }

  return Result.ok({
    status: "updated",
    session: session.value,
    selected: selected.value as HarnessSelectedModel,
  });
}

export async function modelAvailableCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: Omit<ModelSessionCommandInput<TAdapters, TChats>, "selector">,
): Promise<Result<ModelAvailableOutput, ModelCommandError>> {
  const session = await getModelSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const models = await listSessionModels({ ctx: input.ctx, session: session.value });

  if (models.isErr()) {
    return Result.err(models.error);
  }

  const current = await input.ctx.app.harness.getModel({
    target: { type: "session", ref: session.value.ref },
    signal: input.ctx.signal,
  } as GetModelInput<TAdapters>);

  if (current.isErr()) {
    return Result.err(current.error);
  }

  return Result.ok({
    status: "available",
    session: session.value,
    current: current.value as HarnessSelectedModel,
    models: models.value as readonly HarnessModelInfo[],
    maxModelsPerProvider: input.ctx.app.config.model.maxModelsPerProvider,
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

interface GetModelSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

async function getModelSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: GetModelSessionForThreadInput<TAdapters, TChats>,
): Promise<
  Result<
    SessionRecord,
    | StoreError
    | ModelNoActiveSessionError
    | ModelSessionRecordMissingError
    | ModelSessionClosedError
  >
> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.err(new ModelNoActiveSessionError({ thread: input.thread }));
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  if (!session.value) {
    return Result.err(new ModelSessionRecordMissingError({ sessionRef: binding.value.sessionRef }));
  }

  if (session.value.status !== "open") {
    return Result.err(new ModelSessionClosedError({ sessionRef: session.value.ref }));
  }

  return Result.ok(session.value);
}
