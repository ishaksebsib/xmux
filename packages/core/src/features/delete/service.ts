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
  allHarnessesFailed,
  findSessionsByShortId,
  listHarnessSelectableSessions,
  listSessionSelectionCatalog,
  type ListedSelectableSession,
  type SessionSelectionGroup,
  type SessionSelectionListFailure,
} from "../shared/session-selection";
import { requireConfiguredHarnessId } from "../utils";
import { getCurrentWorkspaceCwd, type GetCurrentWorkspaceCwdError } from "../workspace";
import {
  DeleteCommandHarnessNotConfiguredError,
  DeleteCommandIncompleteTargetError,
  DeleteSessionListAllFailedError,
  DeleteSessionShortIdAmbiguousError,
  DeleteSessionShortIdNotFoundError,
} from "./errors";

export type DeleteCommandError =
  | StoreError
  | GetCurrentWorkspaceCwdError
  | ListSessionsError
  | DeleteSessionError
  | DeleteCommandHarnessNotConfiguredError
  | DeleteCommandIncompleteTargetError
  | DeleteSessionListAllFailedError
  | DeleteSessionShortIdNotFoundError
  | DeleteSessionShortIdAmbiguousError;

export type DeleteCommandOutput = DeleteListOutput | DeleteSessionOutput;

export interface DeleteListOutput {
  readonly status: "listed";
  readonly cwd: string;
  readonly groups: readonly SessionSelectionGroup[];
  readonly failures: readonly SessionSelectionListFailure[];
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

/** Deletes the active session, lists sessions, or deletes a selected session by short id. */
export async function deleteSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: DeleteSessionCommandInput<TAdapters, TChats>,
): Promise<Result<DeleteCommandOutput, DeleteCommandError>> {
  const target = parseDeleteTarget({ harnessId: input.harnessId, shortId: input.shortId });

  if (target.isErr()) {
    return Result.err(target.error);
  }

  if (target.value.status === "active_or_list") {
    return deleteActiveSessionOrList(input);
  }

  const cwd = await getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread });

  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  return deleteSelectedSession({
    ctx: input.ctx,
    thread: input.thread,
    cwd: cwd.value,
    harnessId: target.value.harnessId,
    shortId: target.value.shortId,
  });
}

type DeleteTarget =
  | { readonly status: "active_or_list" }
  | { readonly status: "delete"; readonly harnessId: string; readonly shortId: string };

function parseDeleteTarget(input: {
  readonly harnessId?: string;
  readonly shortId?: string;
}): Result<DeleteTarget, DeleteCommandIncompleteTargetError> {
  const harnessId = input.harnessId?.trim();
  const shortId = input.shortId?.trim();

  if (!harnessId && !shortId) {
    return Result.ok({ status: "active_or_list" });
  }

  if (!harnessId || !shortId) {
    return Result.err(
      new DeleteCommandIncompleteTargetError({
        ...(harnessId ? { harnessId } : {}),
        ...(shortId ? { shortId } : {}),
      }),
    );
  }

  return Result.ok({ status: "delete", harnessId, shortId });
}

async function deleteActiveSessionOrList<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: DeleteSessionCommandInput<TAdapters, TChats>,
): Promise<Result<DeleteCommandOutput, DeleteCommandError>> {
  const active = await getBoundSessionRecord({ ctx: input.ctx, thread: input.thread });

  if (active.isErr()) {
    return Result.err(active.error);
  }

  if (active.value) {
    return deleteSessionEverywhere({
      ctx: input.ctx,
      thread: input.thread,
      session: {
        ref: active.value.ref,
        shortId: active.value.ref.sessionId,
        cwd: active.value.cwd,
        title: active.value.title,
      },
    });
  }

  const cwd = await getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread });

  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  return listDeleteSessions({ ctx: input.ctx, cwd: cwd.value });
}

async function listDeleteSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
}): Promise<Result<DeleteListOutput, DeleteCommandError>> {
  const catalog = await listSessionSelectionCatalog({
    ctx: input.ctx,
    cwd: input.cwd,
    maxSessionsPerHarness: input.ctx.app.config.resume.maxSessionsPerHarness,
  });

  if (allHarnessesFailed({ harnessIds: input.ctx.app.harnessIds, failures: catalog.failures })) {
    return Result.err(new DeleteSessionListAllFailedError({ failures: catalog.failures }));
  }

  return Result.ok({
    status: "listed",
    cwd: input.cwd,
    groups: catalog.groups,
    failures: catalog.failures,
  });
}

async function deleteSelectedSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly cwd: string;
  readonly harnessId: string;
  readonly shortId: string;
}): Promise<Result<DeleteSessionOutput, DeleteCommandError>> {
  const harnessId = requireConfiguredHarnessId({
    harnessId: input.harnessId,
    availableHarnessIds: input.ctx.app.harnessIds,
    onMissing: (args) => new DeleteCommandHarnessNotConfiguredError(args),
  });

  if (harnessId.isErr()) {
    return Result.err(harnessId.error);
  }

  const listed = await listHarnessSelectableSessions({
    ctx: input.ctx,
    harnessId: harnessId.value,
    cwd: input.cwd,
  });

  if (listed.isErr()) {
    return Result.err(listed.error);
  }

  const selected = resolveSelectedSession({
    harnessId: harnessId.value,
    shortId: input.shortId,
    cwd: input.cwd,
    sessions: listed.value.sessions,
  });

  if (selected.isErr()) {
    return Result.err(selected.error);
  }

  return deleteSessionEverywhere({
    ctx: input.ctx,
    thread: input.thread,
    session: {
      ref: { harnessId: harnessId.value, sessionId: selected.value.sessionId },
      shortId: input.shortId,
      cwd: selected.value.cwd ?? input.cwd,
      title: selected.value.title,
    },
  });
}

function resolveSelectedSession(input: {
  readonly harnessId: string;
  readonly shortId: string;
  readonly cwd: string;
  readonly sessions: readonly ListedSelectableSession[];
}): Result<
  ListedSelectableSession,
  DeleteSessionShortIdNotFoundError | DeleteSessionShortIdAmbiguousError
> {
  const matches = findSessionsByShortId({ sessions: input.sessions, shortId: input.shortId });

  if (matches.length === 0) {
    return Result.err(
      new DeleteSessionShortIdNotFoundError({
        harnessId: input.harnessId,
        shortId: input.shortId,
        cwd: input.cwd,
      }),
    );
  }

  if (matches.length > 1) {
    return Result.err(
      new DeleteSessionShortIdAmbiguousError({
        harnessId: input.harnessId,
        shortId: input.shortId,
        cwd: input.cwd,
        matchingSessionIds: matches.map((session) => session.sessionId),
      }),
    );
  }

  const selected = matches[0];
  return selected
    ? Result.ok(selected)
    : Result.err(
        new DeleteSessionShortIdNotFoundError({
          harnessId: input.harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
        }),
      );
}

async function deleteSessionEverywhere<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly session: DeletedSessionSummary;
}): Promise<Result<DeleteSessionOutput, DeleteCommandError>> {
  const deleted = await input.ctx.app.harness.deleteSession(
    createHarnessDeleteInput({
      ref: input.session.ref,
      signal: input.ctx.signal,
    }) as DeleteSessionInput<TAdapters>,
  );

  if (deleted.isErr()) {
    return Result.err(deleted.error);
  }

  const cleaned = await cleanupDeletedSession({
    ctx: input.ctx,
    thread: input.thread,
    ref: input.session.ref,
  });

  if (cleaned.isErr()) {
    return Result.err(cleaned.error);
  }

  return Result.ok({ status: "deleted", session: input.session });
}

async function getBoundSessionRecord<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}): Promise<Result<SessionRecord | null, StoreError>> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.ok(null);
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  if (!session.value) {
    const deleted = await input.ctx.app.store.threadBindings.delete(input.thread);
    return deleted.isErr() ? Result.err(deleted.error) : Result.ok(null);
  }

  return Result.ok(session.value);
}

async function cleanupDeletedSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly ref: SessionRef;
}): Promise<Result<void, StoreError>> {
  const removedSession = await input.ctx.app.store.sessions.delete(input.ref);

  if (removedSession.isErr()) {
    return Result.err(removedSession.error);
  }

  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (binding.value && sameSessionRef(binding.value.sessionRef, input.ref)) {
    return input.ctx.app.store.threadBindings.delete(input.thread);
  }

  return Result.ok();
}

function sameSessionRef(left: SessionRef, right: SessionRef): boolean {
  return left.harnessId === right.harnessId && left.sessionId === right.sessionId;
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
