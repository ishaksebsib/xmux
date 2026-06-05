import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessSessionInfo,
  ListSessionsError,
  ResumeSessionError,
  ResumeSessionInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import {
  createSessionRecord,
  createThreadBinding,
  type ActorRef,
  type ChatThreadRef,
  type SessionRecord,
} from "../../store";
import {
  allHarnessesFailed,
  findSessionsByShortId,
  listHarnessSelectableSessions,
  listSessionSelectionCatalog,
  type ListedSelectableSession,
  type SessionSelectionGroup,
} from "../shared/session-selection";
import { requireConfiguredHarnessId } from "../utils";
import { getCurrentWorkspaceCwd, type GetCurrentWorkspaceCwdError } from "../workspace";
import {
  ResumeCommandHarnessNotConfiguredError,
  ResumeCommandIncompleteTargetError,
  ResumeSessionListAllFailedError,
  ResumeSessionShortIdAmbiguousError,
  ResumeSessionShortIdNotFoundError,
  type ResumeSessionListFailure,
} from "./errors";

export type ResumeCommandError =
  | StoreError
  | GetCurrentWorkspaceCwdError
  | ListSessionsError
  | ResumeSessionError
  | ResumeCommandHarnessNotConfiguredError
  | ResumeCommandIncompleteTargetError
  | ResumeSessionListAllFailedError
  | ResumeSessionShortIdNotFoundError
  | ResumeSessionShortIdAmbiguousError;

export type ResumeCommandOutput = ResumeListOutput | ResumeActivatedOutput;

export interface ResumeListOutput {
  readonly status: "listed";
  readonly cwd: string;
  readonly groups: readonly ResumeSessionGroup[];
  readonly failures: readonly ResumeSessionListFailure[];
}

export interface ResumeActivatedOutput {
  readonly status: "resumed";
  readonly session: SessionRecord;
  readonly shortId: string;
}

export type ResumeSessionGroup = SessionSelectionGroup;
export type ListedResumeSession = ListedSelectableSession;

export interface ResumeSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId?: string;
  readonly shortId?: string;
}

/** Lists resumable sessions or resumes one selected by harness id and short session id. */
export async function resumeSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ResumeSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ResumeCommandOutput, ResumeCommandError>> {
  return Result.gen(async function* () {
    const target = yield* parseResumeTarget({ harnessId: input.harnessId, shortId: input.shortId });

    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );

    if (target.status === "list") {
      return Result.ok(yield* Result.await(listResumeSessions({ ctx: input.ctx, cwd })));
    }

    return Result.ok(
      yield* Result.await(
        resumeSelectedSession({
          ctx: input.ctx,
          thread: input.thread,
          cwd,
          harnessId: target.harnessId,
          shortId: target.shortId,
        }),
      ),
    );
  });
}

type ResumeTarget =
  | { readonly status: "list" }
  | { readonly status: "resume"; readonly harnessId: string; readonly shortId: string };

function parseResumeTarget(input: {
  readonly harnessId?: string;
  readonly shortId?: string;
}): Result<ResumeTarget, ResumeCommandIncompleteTargetError> {
  const harnessId = input.harnessId?.trim();
  const shortId = input.shortId?.trim();

  if (!harnessId && !shortId) {
    return Result.ok({ status: "list" });
  }

  if (!harnessId || !shortId) {
    return Result.err(
      new ResumeCommandIncompleteTargetError({
        ...(harnessId ? { harnessId } : {}),
        ...(shortId ? { shortId } : {}),
      }),
    );
  }

  return Result.ok({ status: "resume", harnessId, shortId });
}

async function listResumeSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
}): Promise<Result<ResumeListOutput, ResumeCommandError>> {
  const catalog = await listSessionSelectionCatalog({
    ctx: input.ctx,
    cwd: input.cwd,
    maxSessionsPerHarness: input.ctx.app.config.resume.maxSessionsPerHarness,
  });

  if (allHarnessesFailed({ harnessIds: input.ctx.app.harnessIds, failures: catalog.failures })) {
    return Result.err(new ResumeSessionListAllFailedError({ failures: catalog.failures }));
  }

  return Result.ok({
    status: "listed",
    cwd: input.cwd,
    groups: catalog.groups,
    failures: catalog.failures,
  });
}

async function resumeSelectedSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly cwd: string;
  readonly harnessId: string;
  readonly shortId: string;
}): Promise<Result<ResumeActivatedOutput, ResumeCommandError>> {
  return Result.gen(async function* () {
    const harnessId = yield* requireConfiguredHarnessId({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      onMissing: (args) => new ResumeCommandHarnessNotConfiguredError(args),
    });

    const listed = yield* Result.await(
      listHarnessSelectableSessions({
        ctx: input.ctx,
        harnessId,
        cwd: input.cwd,
      }),
    );

    const matches = findSessionsByShortId({
      sessions: listed.sessions,
      shortId: input.shortId,
    });

    if (matches.length === 0) {
      return Result.err(
        new ResumeSessionShortIdNotFoundError({
          harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
        }),
      );
    }

    if (matches.length > 1) {
      return Result.err(
        new ResumeSessionShortIdAmbiguousError({
          harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
          matchingSessionIds: matches.map((session) => session.sessionId),
        }),
      );
    }

    const selected = matches[0];
    if (!selected) {
      return Result.err(
        new ResumeSessionShortIdNotFoundError({
          harnessId,
          shortId: input.shortId,
          cwd: input.cwd,
        }),
      );
    }

    const resumed = yield* Result.await(
      input.ctx.app.harness.resumeSession(
        createHarnessResumeInput({
          harnessId,
          sessionId: selected.sessionId,
          cwd: input.cwd,
          signal: input.ctx.signal,
        }) as ResumeSessionInput<TAdapters>,
      ),
    );

    const stored = yield* Result.await(
      upsertResumedSessionRecord({
        ctx: input.ctx,
        thread: input.thread,
        cwd: resumed.cwd ?? input.cwd,
        session: resumed,
      }),
    );

    const now = input.ctx.app.services.now().toISOString();
    yield* Result.await(
      input.ctx.app.store.threadBindings.bind(
        createThreadBinding({ thread: input.thread, sessionRef: stored.ref, now }),
      ),
    );

    return Result.ok({ status: "resumed" as const, session: stored, shortId: input.shortId });
  });
}

async function upsertResumedSessionRecord<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly cwd: string;
  readonly session: HarnessSessionInfo;
}): Promise<Result<SessionRecord, StoreError>> {
  return Result.gen(async function* () {
    const existing = yield* Result.await(input.ctx.app.store.sessions.get(input.session.ref));

    const now = input.ctx.app.services.now().toISOString();

    if (existing) {
      return Result.ok(
        yield* Result.await(
          input.ctx.app.store.sessions.update(input.session.ref, {
            status: "open",
            deliveryMode: input.ctx.app.config.deliveryMode,
            updatedAt: now,
            closedAt: undefined,
            ...(input.session.title === undefined ? {} : { title: input.session.title }),
          }),
        ),
      );
    }

    return Result.ok(
      yield* Result.await(
        input.ctx.app.store.sessions.create(
          createSessionRecord({
            ref: input.session.ref,
            origin: input.thread,
            requester: input.ctx.actor ?? UNKNOWN_ACTOR,
            cwd: input.cwd,
            deliveryMode: input.ctx.app.config.deliveryMode,
            title: input.session.title,
            now,
          }),
        ),
      ),
    );
  });
}

const UNKNOWN_ACTOR = { userId: "unknown" } satisfies ActorRef;

function createHarnessResumeInput<THarnessId extends string>(input: {
  readonly harnessId: THarnessId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
}) {
  return {
    harnessId: input.harnessId,
    sessionId: input.sessionId,
    cwd: input.cwd,
    signal: input.signal,
  };
}
