import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessModelRef,
  HarnessThinkingLevel,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { NoActiveSessionError, SessionRecordMissingError } from "../errors";
import { getActiveSessionForThread } from "../session";
import { modelSessionCommand } from "../model/service";
import type { PromptRunState } from "../prompt";

export type MenuSessionState =
  | { readonly status: "inactive" }
  | {
      readonly status: "active";
      readonly record: SessionRecord;
      readonly prompt: MenuPromptState;
      readonly queueCount: number;
      readonly details: MenuSessionDetails;
    };

export type MenuPromptState =
  | { readonly status: "idle" }
  | {
      readonly status: "running";
      readonly runState: Extract<PromptRunState, "starting" | "running">;
    }
  | { readonly status: "cancelling" };

export type MenuSessionDetails =
  | {
      readonly status: "available";
      readonly model: HarnessModelRef | undefined;
      readonly thinkingSupported: boolean;
      readonly thinkingLevel?: HarnessThinkingLevel;
    }
  | { readonly status: "unavailable" };

export interface MenuState {
  readonly thread: ChatThreadRef;
  readonly harnessIds: readonly string[];
  readonly session: MenuSessionState;
}

export type ResolveMenuStateError = StoreError;

export async function resolveMenuState<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}): Promise<Result<MenuState, ResolveMenuStateError>> {
  const active = await getActiveSessionForThread(input.ctx, input.thread);

  if (active.isErr()) {
    if (NoActiveSessionError.is(active.error) || SessionRecordMissingError.is(active.error)) {
      return Result.ok({
        thread: input.thread,
        harnessIds: input.ctx.app.harnessIds,
        session: { status: "inactive" },
      });
    }

    return Result.err(active.error);
  }

  return Result.ok({
    thread: input.thread,
    harnessIds: input.ctx.app.harnessIds,
    session: {
      status: "active",
      record: active.value,
      prompt: resolvePromptState(input.ctx, active.value),
      queueCount: input.ctx.app.services.promptQueue.list(active.value.ref).length,
      details: await resolveSessionDetails({
        ctx: input.ctx,
        thread: input.thread,
      }),
    },
  });
}

async function resolveSessionDetails<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}): Promise<MenuSessionDetails> {
  const details = await modelSessionCommand({ ctx: input.ctx, thread: input.thread });

  if (details.isErr() || details.value.status !== "shown") {
    return { status: "unavailable" };
  }

  return {
    status: "available",
    model: details.value.current.model,
    thinkingSupported: details.value.thinkingSupported,
    ...(details.value.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: details.value.thinkingLevel }),
  };
}

function resolvePromptState<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: HandlerContext<TAdapters, TChats>, session: SessionRecord): MenuPromptState {
  const run = ctx.app.services.promptRuns.get(session.ref);
  if (run === undefined) return { status: "idle" };

  switch (run.state) {
    case "starting":
    case "running":
      return { status: "running", runState: run.state };
    case "cancelling":
      return { status: "cancelling" };
    case "completed":
    case "failed":
    case "aborted":
      return { status: "idle" };
  }
}

export function isMenuSessionIdle(state: MenuState): boolean {
  return state.session.status === "active" && state.session.prompt.status === "idle";
}

export function isMenuSessionBusy(state: MenuState): boolean {
  return state.session.status === "active" && state.session.prompt.status !== "idle";
}

export function isMenuSessionRunning(state: MenuState): boolean {
  return state.session.status === "active" && state.session.prompt.status === "running";
}
