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
import type {
  NoActiveSessionError,
  SessionClosedError,
  SessionRecordMissingError,
} from "../errors";
import { resolveModelSelector, type ResolveModelSelectorError } from "./selector";
import { getActiveSessionForThread } from "../session";

export type ModelCommandError =
  | StoreError
  | ListModelsError
  | GetModelError
  | SetModelError
  | ResolveModelSelectorError
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
