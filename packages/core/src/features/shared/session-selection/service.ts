import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessSessionInfo,
  ListSessionsError,
  ListSessionsInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";

export interface SessionSelectionListFailure {
  readonly harnessId: string;
  readonly error: ListSessionsError;
}

export interface SessionSelectionGroup {
  readonly harnessId: string;
  readonly sessions: readonly ListedSelectableSession[];
  readonly totalSessionCount: number;
}

export interface ListedSelectableSession {
  readonly harnessId: string;
  readonly sessionId: string;
  readonly shortId: string;
  readonly title?: string;
  readonly cwd?: string;
}

export interface SessionSelectionCatalog {
  readonly groups: readonly SessionSelectionGroup[];
  readonly failures: readonly SessionSelectionListFailure[];
}

/** Lists selectable sessions across every configured harness for a cwd. */
export async function listSessionSelectionCatalog<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly cwd: string;
  readonly maxSessionsPerHarness?: number;
}): Promise<SessionSelectionCatalog> {
  const groups = [] as SessionSelectionGroup[];
  const failures = [] as SessionSelectionListFailure[];

  for (const harnessId of input.ctx.app.harnessIds) {
    const listed = await listHarnessSelectableSessions({
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

/** Lists selectable sessions for one harness and computes shortest unique short ids. */
export async function listHarnessSelectableSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
  THarnessId extends Extract<keyof TAdapters, string>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly harnessId: THarnessId;
  readonly cwd: string;
  readonly maxSessions?: number;
}): Promise<Result<SessionSelectionGroup, ListSessionsError>> {
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

  const listing = toSessionSelectionListing({
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

export function allHarnessesFailed(input: {
  readonly harnessIds: readonly string[];
  readonly failures: readonly SessionSelectionListFailure[];
}): boolean {
  return input.harnessIds.length > 0 && input.failures.length === input.harnessIds.length;
}

export function findSessionsByShortId(input: {
  readonly sessions: readonly ListedSelectableSession[];
  readonly shortId: string;
}): readonly ListedSelectableSession[] {
  return input.sessions.filter((session) => session.sessionId.startsWith(input.shortId));
}

function toSessionSelectionListing(input: {
  readonly harnessId: string;
  readonly sessions: readonly HarnessSessionInfo[];
  readonly maxSessions?: number;
}): { readonly sessions: readonly ListedSelectableSession[]; readonly totalSessionCount: number } {
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
