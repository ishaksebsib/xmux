import { access } from "node:fs/promises";
import path from "node:path";
import {
  SessionManager,
  type AgentSession,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { HarnessAdapterSessionInfo, HarnessModelRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { mergePiCreateOptions } from "../config";
import {
  PiSessionAmbiguousError,
  PiSessionNotFoundError,
  PiSessionRequestError,
  PiSessionResponseError,
} from "../errors";
import type { PiRuntime, PiSessionHandle } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";

export type PiSessionHandlerError =
  | PiSessionRequestError
  | PiSessionResponseError
  | PiSessionNotFoundError
  | PiSessionAmbiguousError;

export type ResolvedPiSession = {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  readonly handle?: PiSessionHandle;
  readonly info?: SessionInfo;
};

function normalizeComparablePath(value: string): string {
  return path.resolve(value);
}

export function toModelRef(model: AgentSession["model"]): HarnessModelRef | undefined {
  if (!model) return undefined;
  return { providerId: model.provider, modelId: model.id };
}

export function mapLiveSession(handle: PiSessionHandle): HarnessAdapterSessionInfo<PiSessionInfo> {
  return {
    sessionId: handle.sessionId,
    cwd: handle.cwd,
    title: handle.session.sessionName,
    model: toModelRef(handle.session.model),
    adapterData: {
      sessionFile: handle.sessionFile,
      sessionDir: handle.sessionDir,
      agentDir: handle.agentDir,
      name: handle.session.sessionName,
      messageCount: handle.session.messages.length,
    },
  };
}

export function mapPiSessionInfo(info: SessionInfo): HarnessAdapterSessionInfo<PiSessionInfo> {
  return {
    sessionId: info.id,
    cwd: info.cwd || undefined,
    title: info.name,
    adapterData: {
      sessionFile: info.path,
      sessionDir: path.dirname(info.path),
      name: info.name,
      messageCount: info.messageCount,
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
    },
  };
}

export function createPiSessionHandle(args: {
  readonly session: AgentSession;
  readonly cwd?: string;
  readonly sessionDir?: string;
  readonly agentDir?: string;
}): PiSessionHandle {
  return {
    session: args.session,
    cwd: args.cwd ?? args.session.sessionManager.getCwd(),
    sessionId: args.session.sessionId,
    sessionFile: args.session.sessionFile,
    sessionDir: args.sessionDir ?? args.session.sessionManager.getSessionDir(),
    agentDir: args.agentDir,
    dispose: () => args.session.dispose(),
  };
}

export async function listPiSessions(args: {
  readonly operation: string;
  readonly cwd?: string;
  readonly sessionDir?: string;
}): Promise<ResultType<readonly SessionInfo[], PiSessionRequestError>> {
  return Result.tryPromise({
    try: () =>
      args.cwd
        ? SessionManager.list(args.cwd, args.sessionDir)
        : SessionManager.listAll(args.sessionDir),
    catch: (cause) => new PiSessionRequestError({ operation: args.operation, cause }),
  });
}

function isNotFoundError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "ENOENT"
  );
}

export async function fileExists(args: {
  readonly operation: string;
  readonly filePath: string;
}): Promise<ResultType<boolean, PiSessionRequestError>> {
  const result = await Result.tryPromise({
    try: () => access(args.filePath),
    catch: (cause) => cause,
  });
  if (result.isOk()) return Result.ok(true);
  return isNotFoundError(result.error)
    ? Result.ok(false)
    : Result.err(new PiSessionRequestError({ operation: args.operation, cause: result.error }));
}

export function validateSessionJsonlPath(args: {
  readonly operation: string;
  readonly sessionPath: string;
}): ResultType<string, PiSessionResponseError> {
  const resolved = path.resolve(args.sessionPath);
  return path.extname(resolved) === ".jsonl"
    ? Result.ok(resolved)
    : Result.err(
        new PiSessionResponseError({
          operation: args.operation,
          reason: "session path must point to a .jsonl file",
          detail: resolved,
        }),
      );
}

export async function resolvePiSession(args: {
  readonly runtime: PiRuntime;
  readonly operation: string;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly adapterOptions?: PiCreateOptions;
}): Promise<ResultType<ResolvedPiSession, PiSessionHandlerError>> {
  const live = args.runtime.sessions.get(args.sessionId);
  if (live) {
    return Result.ok({
      sessionId: live.sessionId,
      cwd: live.cwd,
      sessionFile: live.sessionFile,
      sessionDir: live.sessionDir,
      handle: live,
    });
  }

  const options = mergePiCreateOptions(args.runtime.config, args.adapterOptions);
  if (options.sessionPath) {
    const configuredSessionPath = options.sessionPath;
    return Result.gen(async function* () {
      const sessionPath = yield* validateSessionJsonlPath({
        operation: args.operation,
        sessionPath: configuredSessionPath,
      });
      const exists = yield* Result.await(
        fileExists({ operation: args.operation, filePath: sessionPath }),
      );
      if (!exists) {
        return Result.err(
          new PiSessionNotFoundError({
            sessionId: args.sessionId,
            cwd: args.cwd,
            sessionPath,
          }),
        );
      }

      const manager = yield* Result.try({
        try: () => SessionManager.open(sessionPath, options.sessionDir, args.cwd),
        catch: (cause) => new PiSessionRequestError({ operation: args.operation, cause }),
      });

      if (manager.getSessionId() !== args.sessionId) {
        return Result.err(
          new PiSessionNotFoundError({
            sessionId: args.sessionId,
            cwd: args.cwd,
            sessionPath,
          }),
        );
      }

      return Result.ok({
        sessionId: manager.getSessionId(),
        cwd: manager.getCwd(),
        sessionFile: manager.getSessionFile(),
        sessionDir: manager.getSessionDir(),
      });
    });
  }

  return Result.gen(async function* () {
    const sessions = yield* Result.await(
      listPiSessions({ operation: args.operation, cwd: args.cwd, sessionDir: options.sessionDir }),
    );
    const matches = sessions.filter((session) => session.id === args.sessionId);

    if (matches.length === 0) {
      return Result.err(new PiSessionNotFoundError({ sessionId: args.sessionId, cwd: args.cwd }));
    }
    if (matches.length > 1) {
      return Result.err(
        new PiSessionAmbiguousError({
          sessionId: args.sessionId,
          matches: matches.map((match) => match.path),
        }),
      );
    }

    const match = matches[0];
    if (!match) {
      return Result.err(new PiSessionNotFoundError({ sessionId: args.sessionId, cwd: args.cwd }));
    }

    return Result.ok({
      sessionId: match.id,
      cwd: match.cwd || undefined,
      sessionFile: match.path,
      sessionDir: path.dirname(match.path),
      info: match,
    });
  });
}

export function mergeListedSessions(args: {
  readonly runtime: PiRuntime;
  readonly sessions: readonly SessionInfo[];
  readonly cwd?: string;
}): readonly HarnessAdapterSessionInfo<PiSessionInfo>[] {
  const byId = new Map<string, HarnessAdapterSessionInfo<PiSessionInfo>>();
  for (const info of args.sessions) {
    byId.set(info.id, mapPiSessionInfo(info));
  }

  const cwd = args.cwd === undefined ? undefined : normalizeComparablePath(args.cwd);
  for (const handle of args.runtime.sessions.values()) {
    if (cwd !== undefined && normalizeComparablePath(handle.cwd) !== cwd) continue;
    byId.set(handle.sessionId, mapLiveSession(handle));
  }

  return [...byId.values()];
}
