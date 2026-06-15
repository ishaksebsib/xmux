import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../ctx";
import type { StoreError } from "../errors";
import type { ChatThreadRef, SessionRecord } from "../store";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "./errors";

export type ActiveSessionError =
  | StoreError
  | NoActiveSessionError
  | SessionRecordMissingError
  | SessionClosedError;

/**
 * Resolves the active session record bound to a chat thread.
 *
 * Returns `NoActiveSessionError` when the thread has no binding,
 * `SessionRecordMissingError` when the binding points at a missing record,
 * and `SessionClosedError` when the session is no longer open.
 */
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
      return Result.err(new SessionRecordMissingError({ sessionRef: binding.sessionRef }));
    }

    if (session.status !== "open") {
      return Result.err(new SessionClosedError({ sessionRef: session.ref }));
    }

    return Result.ok(session);
  });
}
