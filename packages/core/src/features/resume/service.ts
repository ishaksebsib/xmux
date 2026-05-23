import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessSessionInfo,
  ListSessionsError,
  ListSessionsInput,
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

export interface ResumeSessionGroup {
  readonly harnessId: string;
  readonly sessions: readonly ListedResumeSession[];
  readonly totalSessionCount: number;
}

export interface ListedResumeSession {
  readonly harnessId: string;
  readonly sessionId: string;
  readonly shortId: string;
  readonly title?: string;
  readonly cwd?: string;
}

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
  const target = parseResumeTarget({ harnessId: input.harnessId, shortId: input.shortId });

  if (target.isErr()) {
    return Result.err(target.error);
  }

  const cwd = await getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread });

  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  if (target.value.status === "list") {
    return listResumeSessions({ ctx: input.ctx, cwd: cwd.value });
  }

  return resumeSelectedSession({
    ctx: input.ctx,
    thread: input.thread,
    cwd: cwd.value,
    harnessId: target.value.harnessId,
    shortId: target.value.shortId,
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
  const catalog = await buildResumeCatalog({
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
  const harnessId = requireConfiguredHarnessId({
    harnessId: input.harnessId,
    availableHarnessIds: input.ctx.app.harnessIds,
    onMissing: (args) => new ResumeCommandHarnessNotConfiguredError(args),
  });

  if (harnessId.isErr()) {
    return Result.err(harnessId.error);
  }

  const listed = await listHarnessSessions({
    ctx: input.ctx,
    harnessId: harnessId.value,
    cwd: input.cwd,
  });

  if (listed.isErr()) {
    return Result.err(listed.error);
  }

  const matches = listed.value.sessions.filter((session) =>
    session.sessionId.startsWith(input.shortId),
  );

  if (matches.length === 0) {
    return Result.err(
      new ResumeSessionShortIdNotFoundError({
        harnessId: harnessId.value,
        shortId: input.shortId,
        cwd: input.cwd,
      }),
    );
  }

  if (matches.length > 1) {
    return Result.err(
      new ResumeSessionShortIdAmbiguousError({
        harnessId: harnessId.value,
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
        harnessId: harnessId.value,
        shortId: input.shortId,
        cwd: input.cwd,
      }),
    );
  }

  const resumed = await input.ctx.app.harness.resumeSession(
    createHarnessResumeInput({
      harnessId: harnessId.value,
      sessionId: selected.sessionId,
      cwd: input.cwd,
      signal: input.ctx.signal,
    }) as ResumeSessionInput<TAdapters>,
  );

  if (resumed.isErr()) {
    return Result.err(resumed.error);
  }

  const stored = await upsertResumedSessionRecord({
    ctx: input.ctx,
    thread: input.thread,
    cwd: resumed.value.cwd ?? input.cwd,
    session: resumed.value,
  });

  if (stored.isErr()) {
    return Result.err(stored.error);
  }

  const now = input.ctx.app.services.now().toISOString();
  const bound = await input.ctx.app.store.threadBindings.bind(
    createThreadBinding({ thread: input.thread, sessionRef: stored.value.ref, now }),
  );

  if (bound.isErr()) {
    return Result.err(bound.error);
  }

  return Result.ok({ status: "resumed", session: stored.value, shortId: input.shortId });
}

async function buildResumeCatalog<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
  readonly maxSessionsPerHarness?: number;
}): Promise<{
  readonly groups: readonly ResumeSessionGroup[];
  readonly failures: readonly ResumeSessionListFailure[];
}> {
  const groups = [] as ResumeSessionGroup[];
  const failures = [] as ResumeSessionListFailure[];

  for (const harnessId of input.ctx.app.harnessIds) {
    const listed = await listHarnessSessions({
      ctx: input.ctx,
      harnessId,
      cwd: input.cwd,
      maxSessions: input.maxSessionsPerHarness,
    });

    if (listed.isErr()) {
      failures.push({ harnessId, error: listed.error });
      continue;
    }

    groups.push(listed.value);
  }

  return { groups, failures };
}

async function listHarnessSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  THarnessId extends Extract<keyof TAdapters, string>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly harnessId: THarnessId;
  readonly cwd: string;
  readonly maxSessions?: number;
}): Promise<Result<ResumeSessionGroup, ListSessionsError>> {
  const listed = await input.ctx.app.harness.listSessions(
    createHarnessListInput({
      harnessId: input.harnessId,
      cwd: input.cwd,
      signal: input.ctx.signal,
    }) as unknown as ListSessionsInput<TAdapters>,
  );

  if (listed.isErr()) {
    return Result.err(listed.error);
  }

  const listing = toResumeSessionListing({
    harnessId: input.harnessId,
    sessions: listed.value,
    maxSessions: input.maxSessions,
  });

  return Result.ok({
    harnessId: input.harnessId,
    sessions: listing.sessions,
    totalSessionCount: listing.totalSessionCount,
  });
}

function allHarnessesFailed(input: {
  readonly harnessIds: readonly string[];
  readonly failures: readonly ResumeSessionListFailure[];
}): boolean {
  return input.harnessIds.length > 0 && input.failures.length === input.harnessIds.length;
}

function toResumeSessionListing(input: {
  readonly harnessId: string;
  readonly sessions: readonly HarnessSessionInfo[];
  readonly maxSessions?: number;
}): { readonly sessions: readonly ListedResumeSession[]; readonly totalSessionCount: number } {
  const sessions = deduplicateBySessionId(input.sessions);
  const prefixes = shortestUniquePrefixes(
    sessions.map((session) => ({ sessionId: session.ref.sessionId })),
  );
  const visibleSessions =
    input.maxSessions === undefined ? sessions : sessions.slice(0, input.maxSessions);

  return {
    totalSessionCount: sessions.length,
    sessions: visibleSessions.map((session) => ({
      harnessId: input.harnessId,
      sessionId: session.ref.sessionId,
      shortId: prefixes.get(session.ref.sessionId) ?? session.ref.sessionId,
      ...(session.title === undefined ? {} : { title: session.title }),
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    })),
  };
}

function deduplicateBySessionId(
  sessions: readonly HarnessSessionInfo[],
): readonly HarnessSessionInfo[] {
  const seen = new Set<string>();
  const unique = [] as HarnessSessionInfo[];

  for (const session of sessions) {
    if (seen.has(session.ref.sessionId)) {
      continue;
    }

    seen.add(session.ref.sessionId);
    unique.push(session);
  }

  return unique;
}

function shortestUniquePrefixes(
  sessions: readonly { readonly sessionId: string }[],
  minLength = 3,
): ReadonlyMap<string, string> {
  const lengths = new Map<string, number>();

  for (const session of sessions) {
    lengths.set(session.sessionId, Math.min(minLength, session.sessionId.length));
  }

  while (true) {
    const byPrefix = new Map<string, string[]>();

    for (const session of sessions) {
      const length = lengths.get(session.sessionId) ?? session.sessionId.length;
      const prefix = session.sessionId.slice(0, length);
      const ids = byPrefix.get(prefix) ?? [];
      ids.push(session.sessionId);
      byPrefix.set(prefix, ids);
    }

    let changed = false;

    for (const ids of byPrefix.values()) {
      if (ids.length < 2) {
        continue;
      }

      for (const id of ids) {
        const current = lengths.get(id) ?? id.length;
        const next = Math.min(current + 1, id.length);
        if (next !== current) {
          lengths.set(id, next);
          changed = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  return new Map(
    sessions.map((session) => [
      session.sessionId,
      session.sessionId.slice(0, lengths.get(session.sessionId) ?? session.sessionId.length),
    ]),
  );
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
  const existing = await input.ctx.app.store.sessions.get(input.session.ref);

  if (existing.isErr()) {
    return Result.err(existing.error);
  }

  const now = input.ctx.app.services.now().toISOString();

  if (existing.value) {
    return input.ctx.app.store.sessions.update(input.session.ref, {
      status: "open",
      deliveryMode: input.ctx.app.config.deliveryMode,
      updatedAt: now,
      closedAt: undefined,
      ...(input.session.title === undefined ? {} : { title: input.session.title }),
    });
  }

  return input.ctx.app.store.sessions.create(
    createSessionRecord({
      ref: input.session.ref,
      origin: input.thread,
      requester: input.ctx.actor ?? UNKNOWN_ACTOR,
      cwd: input.cwd,
      deliveryMode: input.ctx.app.config.deliveryMode,
      title: input.session.title,
      now,
    }),
  );
}

const UNKNOWN_ACTOR = { userId: "unknown" } satisfies ActorRef;

function createHarnessListInput<THarnessId extends string>(input: {
  readonly harnessId: THarnessId;
  readonly cwd: string;
  readonly signal: AbortSignal;
}) {
  return {
    harnessId: input.harnessId,
    cwd: input.cwd,
    signal: input.signal,
  };
}

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
