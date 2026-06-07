import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  AdapterOptionsFor,
  HarnessAdapterDefinitions,
  HarnessInteractionResponse,
  RespondInteractionInput,
  RespondInteractionInputFor,
  SessionRef,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "../errors";
import {
  getPromptSessionForThread,
  PromptInteractionAlreadyRespondingError,
  PromptInteractionResponseError,
  PromptInteractionUnsupportedError,
} from "../prompt";
import type { ActivePromptRun, PendingPromptInteraction } from "../prompt";

export type InteractionCommandAction =
  | { readonly type: "allow"; readonly always: boolean }
  | { readonly type: "reject" };

export type RespondToCurrentInteractionOutput =
  | {
      readonly status: "responded";
      readonly action: "allowed_once" | "allowed_always" | "rejected";
      readonly session: SessionRecord;
      readonly interaction: PendingPromptInteraction;
      readonly remainingPendingCount: number;
    }
  | { readonly status: "not_active" }
  | { readonly status: "no_active_run"; readonly session: SessionRecord }
  | { readonly status: "no_pending_interaction"; readonly session: SessionRecord };

export type RespondToCurrentInteractionError =
  | StoreError
  | SessionRecordMissingError
  | SessionClosedError
  | PromptInteractionUnsupportedError
  | PromptInteractionAlreadyRespondingError
  | PromptInteractionResponseError;

export interface RespondToCurrentInteractionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly action: InteractionCommandAction;
}

/** Responds to the oldest unresolved interaction for the active prompt run in a chat thread. */
export async function respondToCurrentInteractionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: RespondToCurrentInteractionForThreadInput<TAdapters, TChats>,
): Promise<Result<RespondToCurrentInteractionOutput, RespondToCurrentInteractionError>> {
  const session = await getPromptSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    if (NoActiveSessionError.is(session.error)) {
      return Result.ok({ status: "not_active" });
    }

    return Result.err(session.error);
  }

  const run = input.ctx.app.services.promptRuns.get(session.value.ref);

  if (!run) {
    return Result.ok({ status: "no_active_run", session: session.value });
  }

  const selected = selectCurrentInteraction(run);

  if (selected.status === "none") {
    return Result.ok({ status: "no_pending_interaction", session: session.value });
  }

  if (selected.status === "responding") {
    return Result.err(
      new PromptInteractionAlreadyRespondingError({ sessionRef: session.value.ref }),
    );
  }

  return Result.gen(async function* () {
    const response = yield* createHarnessInteractionResponse({
      session: session.value,
      interaction: selected.interaction,
      action: input.action,
    });

    run.markInteractionResponding(selected.interaction.requestId);

    const respondInput = createHarnessRespondInteractionInput<TAdapters, keyof TAdapters>({
      ref: toConfiguredSessionRef<TAdapters>(session.value.ref),
      cwd: session.value.cwd,
      response,
      signal: input.ctx.signal,
    });

    const respondedResult = await input.ctx.app.harness.respondInteraction(
      respondInput as RespondInteractionInput<TAdapters>,
    );

    if (respondedResult.isErr()) {
      run.markInteractionPending(selected.interaction.requestId);
      return Result.err(
        new PromptInteractionResponseError({
          sessionRef: session.value.ref,
          cause: respondedResult.error,
        }),
      );
    }

    const resolvedStatus = input.action.type === "reject" ? "rejected" : "answered";
    run.markInteractionResolved(selected.interaction.requestId, resolvedStatus);

    return Result.ok({
      status: "responded" as const,
      action: outputAction(input.action),
      session: session.value,
      interaction: selected.interaction,
      remainingPendingCount: run.pendingInteractions.filter(
        (interaction) => interaction.status === "pending",
      ).length,
    });
  });
}

type InteractionSelection =
  | { readonly status: "pending"; readonly interaction: PendingPromptInteraction }
  | { readonly status: "responding"; readonly interaction: PendingPromptInteraction }
  | { readonly status: "none" };

type ConfiguredHarnessId<TAdapters extends HarnessAdapterDefinitions<TAdapters>> = Extract<
  keyof TAdapters,
  string
>;

function toConfiguredSessionRef<TAdapters extends HarnessAdapterDefinitions<TAdapters>>(
  ref: SessionRecord["ref"],
): SessionRef<ConfiguredHarnessId<TAdapters>> {
  return {
    harnessId: ref.harnessId as ConfiguredHarnessId<TAdapters>,
    sessionId: ref.sessionId,
  };
}

function createHarnessRespondInteractionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
>(input: {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly cwd: string;
  readonly response: HarnessInteractionResponse;
  readonly signal: AbortSignal;
}): RespondInteractionInputFor<TAdapters, THarnessId> {
  return {
    ref: input.ref,
    cwd: input.cwd,
    response: input.response,
    adapterOptions: {} as AdapterOptionsFor<TAdapters, THarnessId>,
    signal: input.signal,
  };
}

function selectCurrentInteraction(run: ActivePromptRun): InteractionSelection {
  const interaction = run.pendingInteractions[0];

  if (!interaction) {
    return { status: "none" };
  }

  return interaction.status === "responding"
    ? { status: "responding", interaction }
    : { status: "pending", interaction };
}

function createHarnessInteractionResponse(input: {
  readonly session: SessionRecord;
  readonly interaction: PendingPromptInteraction;
  readonly action: InteractionCommandAction;
}): Result<HarnessInteractionResponse, PromptInteractionUnsupportedError> {
  if (input.action.type === "allow") {
    if (input.interaction.kind !== "permission") {
      return Result.err(
        new PromptInteractionUnsupportedError({
          sessionRef: input.session.ref,
          kind: input.interaction.kind,
          action: "allow",
        }),
      );
    }

    return Result.ok({
      kind: "permission",
      requestId: input.interaction.requestId,
      decision: input.action.always ? "allow_always" : "allow_once",
    });
  }

  return Result.ok(
    input.interaction.kind === "permission"
      ? {
          kind: "permission",
          requestId: input.interaction.requestId,
          decision: "reject",
        }
      : {
          kind: "question",
          requestId: input.interaction.requestId,
          reject: true,
        },
  );
}

function outputAction(
  action: InteractionCommandAction,
): Extract<RespondToCurrentInteractionOutput, { readonly status: "responded" }>["action"] {
  return action.type === "reject" ? "rejected" : action.always ? "allowed_always" : "allowed_once";
}
