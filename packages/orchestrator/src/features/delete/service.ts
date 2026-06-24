import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  DeleteSessionError,
  DeleteSessionInput,
  HarnessAdapterDefinitions,
  ListSessionsError,
  SessionRef,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  parseSessionTarget,
  selectSessionByShortId,
  type SelectSessionByShortIdError,
} from "../shared/session-command";
import type { SessionCommandIncompleteTargetError } from "../shared/session-command";
import { resolveHarnessChoice, type HarnessSelectionOutput } from "../shared/harness-selection";
import {
  listHarnessSelectableSessions,
  type SessionSelectionGroup,
} from "../shared/session-selection";
import { getCurrentWorkspaceCwd, type GetCurrentWorkspaceCwdError } from "../workspace";
import { CommandHarnessNotConfiguredError } from "../errors";
import { requireConfiguredHarnessId } from "../utils";

export type DeleteCommandError =
  | StoreError
  | GetCurrentWorkspaceCwdError
  | ListSessionsError
  | DeleteSessionError
  | SelectSessionByShortIdError
  | SessionCommandIncompleteTargetError
  | CommandHarnessNotConfiguredError;

export type DeleteCommandOutput = DeleteHarnessesOutput | DeleteListOutput | DeleteSessionOutput;

/** Picker output shared with the other session commands (see `/new`, `/resume`). */
export type DeleteHarnessesOutput = HarnessSelectionOutput;

export interface DeleteListOutput {
  readonly status: "listed";
  readonly cwd: string;
  readonly group: SessionSelectionGroup;
}

export interface DeleteSessionOutput {
  readonly status: "deleted";
  readonly session: DeletedSessionSummary;
}

export interface DeletedSessionSummary {
  readonly ref: SessionRef;
  readonly shortId: string;
  readonly cwd?: string;
  readonly title?: string;
}

export interface DeleteSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId?: string;
  readonly shortId?: string;
}

export async function deleteSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: DeleteSessionCommandInput<TAdapters, TChats>,
): Promise<Result<DeleteCommandOutput, DeleteCommandError>> {
  return Result.gen(async function* () {
    const target = yield* parseSessionTarget({
      command: "delete",
      harnessId: input.harnessId,
      shortId: input.shortId,
    });

    if (target.status === "list") {
      return Result.ok(yield* Result.await(deleteActiveSessionOrList(input)));
    }

    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );

    const selected = yield* Result.await(
      selectSessionByShortId({
        ctx: input.ctx,
        cwd,
        harnessId: target.harnessId,
        shortId: target.shortId,
      }),
    );

    return Result.ok(
      yield* Result.await(
        deleteSessionEverywhere({
          ctx: input.ctx,
          session: {
            ref: { harnessId: target.harnessId, sessionId: selected.sessionId },
            shortId: input.shortId ?? selected.shortId,
            cwd: selected.cwd ?? cwd,
            title: selected.title,
          },
        }),
      ),
    );
  });
}

export async function listDeleteSessionsForHarness<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId: string;
}): Promise<Result<DeleteListOutput, DeleteCommandError>> {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );
    const harnessId = yield* requireConfiguredHarnessId({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      onMissing: (args) => new CommandHarnessNotConfiguredError(args),
    });

    return Result.ok(
      yield* Result.await(
        listDeleteSessionsForConfiguredHarness({
          ctx: input.ctx,
          cwd,
          harnessId,
        }),
      ),
    );
  });
}

async function deleteActiveSessionOrList<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: DeleteSessionCommandInput<TAdapters, TChats>,
): Promise<Result<DeleteCommandOutput, DeleteCommandError>> {
  return Result.gen(async function* () {
    const active = yield* Result.await(
      getBoundSessionRecord({ ctx: input.ctx, thread: input.thread }),
    );

    if (active) {
      return Result.ok(
        yield* Result.await(
          deleteSessionEverywhere({
            ctx: input.ctx,
            session: {
              ref: active.ref,
              shortId: active.ref.sessionId,
              cwd: active.cwd,
              title: active.title,
            },
          }),
        ),
      );
    }

    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );

    const harness = yield* resolveHarnessChoice({
      harnessId: undefined,
      availableHarnessIds: input.ctx.app.harnessIds,
      cwd,
    });

    if (harness.status === "harnesses") {
      return Result.ok(harness);
    }

    return Result.ok(
      yield* Result.await(
        listDeleteSessionsForConfiguredHarness({
          ctx: input.ctx,
          cwd,
          harnessId: harness.harnessId,
        }),
      ),
    );
  });
}

async function listDeleteSessionsForConfiguredHarness<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
  readonly harnessId: Extract<keyof TAdapters, string>;
}): Promise<Result<DeleteListOutput, ListSessionsError>> {
  return Result.map(
    await listHarnessSelectableSessions({
      ctx: input.ctx,
      harnessId: input.harnessId,
      cwd: input.cwd,
      maxSessions: input.ctx.app.config.resume.maxSessionsPerHarness,
    }),
    (group) => ({ status: "listed" as const, cwd: input.cwd, group }),
  );
}

async function deleteSessionEverywhere<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: DeletedSessionSummary;
}): Promise<Result<DeleteSessionOutput, DeleteCommandError>> {
  return Result.gen(async function* () {
    yield* Result.await(
      input.ctx.app.harness.deleteSession(
        createHarnessDeleteInput({
          ref: input.session.ref,
          signal: input.ctx.signal,
        }) as DeleteSessionInput<TAdapters>,
      ),
    );

    yield* Result.await(
      cleanupDeletedSession({
        ctx: input.ctx,
        ref: input.session.ref,
      }),
    );

    return Result.ok({ status: "deleted" as const, session: input.session });
  });
}

async function getBoundSessionRecord<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}): Promise<Result<SessionRecord | null, StoreError>> {
  return Result.gen(async function* () {
    const binding = yield* Result.await(input.ctx.app.store.threadBindings.get(input.thread));

    if (!binding) {
      return Result.ok(null);
    }

    const session = yield* Result.await(input.ctx.app.store.sessions.get(binding.sessionRef));

    if (!session) {
      yield* Result.await(input.ctx.app.store.threadBindings.deleteBySession(binding.sessionRef));
      return Result.ok(null);
    }

    return Result.ok(session);
  });
}

async function cleanupDeletedSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly ref: SessionRef;
}): Promise<Result<void, StoreError>> {
  return Result.gen(async function* () {
    yield* Result.await(input.ctx.app.store.sessions.delete(input.ref));
    yield* Result.await(input.ctx.app.store.threadBindings.deleteBySession(input.ref));

    return Result.ok();
  });
}

function createHarnessDeleteInput(input: {
  readonly ref: SessionRef;
  readonly signal: AbortSignal;
}) {
  return {
    ref: input.ref,
    signal: input.signal,
  };
}
