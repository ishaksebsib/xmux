import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import { HarnessSessionNotFoundError } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../ctx";
import type { StoreError } from "../errors";
import { xmuxLogEvents } from "../logger";
import { serializeXmuxLogError } from "../logger-utils";
import type { ChatThreadRef, SessionRecord } from "../store";
import {
  NoActiveSessionError,
  SessionDeletedUpstreamCleanupError,
  SessionDeletedUpstreamError,
  SessionRecordMissingError,
  type UpstreamSessionCleanupOperation,
} from "./errors";

export type ActiveSessionError = StoreError | NoActiveSessionError | SessionRecordMissingError;

export type SessionBoundHarnessOperationError<TError> =
  | TError
  | SessionDeletedUpstreamError
  | SessionDeletedUpstreamCleanupError;

/**
 * Resolves the active session record bound to a chat thread.
 *
 * Returns `NoActiveSessionError` when the thread has no binding, and
 * `SessionRecordMissingError` when the binding points at a missing record.
 * Stale bindings to missing session records are deleted before returning.
 */
export async function runSessionBoundHarnessOperation<
  TValue,
  TError,
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly ref: SessionRef;
  readonly operation: UpstreamSessionCleanupOperation;
  readonly run: () => Promise<Result<TValue, TError>>;
}): Promise<Result<TValue, SessionBoundHarnessOperationError<TError>>> {
  const result = await input.run();

  if (result.isOk()) {
    return Result.ok(result.value);
  }

  if (!HarnessSessionNotFoundError.is(result.error)) {
    return Result.err(result.error);
  }

  const cleanup = await markSessionDeletedUpstream({
    ctx: input.ctx,
    ref: input.ref,
    operation: input.operation,
    cause: result.error,
  });

  if (cleanup.isErr()) {
    return Result.err(cleanup.error);
  }

  return Result.err(cleanup.value);
}

export async function markSessionDeletedUpstream<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly ref: SessionRef;
  readonly operation: UpstreamSessionCleanupOperation;
  readonly cause: HarnessSessionNotFoundError;
}): Promise<Result<SessionDeletedUpstreamError, SessionDeletedUpstreamCleanupError>> {
  const cleanup = await cleanupStaleUpstreamSession({
    ctx: input.ctx,
    ref: input.ref,
    cause: input.cause,
  });

  if (cleanup.isErr()) {
    const error = new SessionDeletedUpstreamCleanupError({
      ref: input.ref,
      operation: input.operation,
      cause: input.cause,
      cleanupCause: cleanup.error,
    });

    input.ctx.logger.error(xmuxLogEvents.operationFailure, {
      operation: input.operation,
      result: "error",
      reason: "session_deleted_upstream_cleanup_failed",
      harnessId: input.ref.harnessId,
      sessionId: input.ref.sessionId,
      error: serializeXmuxLogError(error),
    });

    return Result.err(error);
  }

  const error = new SessionDeletedUpstreamError({
    ref: input.ref,
    operation: input.operation,
    cause: input.cause,
  });

  input.ctx.logger.warn(xmuxLogEvents.operationFailure, {
    operation: input.operation,
    result: "error",
    reason: "session_deleted_upstream",
    harnessId: input.ref.harnessId,
    sessionId: input.ref.sessionId,
    error: serializeXmuxLogError(input.cause),
  });

  return Result.ok(error);
}

/** Removes local state for a session the native harness no longer has. */
export async function cleanupStaleUpstreamSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly ref: SessionRef;
  readonly cause: unknown;
}): Promise<Result<void, StoreError>> {
  return Result.gen(async function* () {
    const activePrompt = input.ctx.app.services.promptRuns.cancel({
      sessionRef: input.ref,
      reason: input.cause,
    });

    if (activePrompt.isOk()) {
      activePrompt.value.release();
    }

    input.ctx.app.services.promptQueue.clearSession(input.ref);
    yield* Result.await(input.ctx.app.store.sessions.delete(input.ref));

    return Result.ok();
  });
}

export async function getActiveSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: HandlerContext<TAdapters, TChats>,
  thread: ChatThreadRef,
): Promise<Result<SessionRecord, ActiveSessionError>> {
  return Result.gen(async function* () {
    const binding = yield* Result.await(ctx.app.store.threadBindings.get(thread));

    if (!binding) {
      return Result.err(new NoActiveSessionError({ thread }));
    }

    const session = yield* Result.await(ctx.app.store.sessions.get(binding.sessionRef));

    if (!session) {
      yield* Result.await(ctx.app.store.threadBindings.deleteBySession(binding.sessionRef));
      return Result.err(new SessionRecordMissingError({ sessionRef: binding.sessionRef }));
    }

    return Result.ok(session);
  });
}
