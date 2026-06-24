import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { AbortError, AbortInput, HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  NoActiveSessionError,
  SessionDeletedUpstreamCleanupError,
  SessionDeletedUpstreamError,
  SessionRecordMissingError,
} from "../errors";
import { PromptRunCancellationError } from "../prompt";
import { getActiveSessionForThread, runSessionBoundHarnessOperation } from "../session";
import type { SessionBoundHarnessOperationError } from "../session";

export interface CancelActivePromptForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

export type CancelActivePromptOutput =
  | { readonly status: "cancelled"; readonly session: SessionRecord }
  | { readonly status: "not_running"; readonly session: SessionRecord }
  | { readonly status: "not_active" };

export type CancelActivePromptError =
  | StoreError
  | SessionRecordMissingError
  | SessionBoundHarnessOperationError<PromptRunCancellationError>;

/** Cancels the active prompt generation for the session bound to a chat thread. */
export async function cancelActivePromptForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: CancelActivePromptForThreadInput<TAdapters, TChats>,
): Promise<Result<CancelActivePromptOutput, CancelActivePromptError>> {
  const session = await getActiveSessionForThread(input.ctx, input.thread);

  if (session.isErr()) {
    if (NoActiveSessionError.is(session.error)) {
      return Result.ok({ status: "not_active" });
    }

    return Result.err(session.error);
  }

  const activeRun = input.ctx.app.services.promptRuns.get(session.value.ref);

  if (!activeRun) {
    return Result.ok({ status: "not_running", session: session.value });
  }

  const cancelled = input.ctx.app.services.promptRuns.cancel({
    sessionRef: session.value.ref,
    reason: "Generation cancelled",
  });

  if (cancelled.isErr()) {
    return Result.ok({ status: "not_running", session: session.value });
  }

  try {
    const aborted = await runSessionBoundHarnessOperation<void, AbortError, TAdapters, TChats>({
      ctx: input.ctx,
      ref: session.value.ref,
      operation: "abort",
      run: () =>
        input.ctx.app.harness.abort({
          ref: session.value.ref,
          signal: input.ctx.signal,
        } as AbortInput<TAdapters>),
    });

    if (aborted.isErr()) {
      if (
        SessionDeletedUpstreamError.is(aborted.error) ||
        SessionDeletedUpstreamCleanupError.is(aborted.error)
      ) {
        return Result.err(aborted.error);
      }

      return Result.err(
        new PromptRunCancellationError({ sessionRef: session.value.ref, cause: aborted.error }),
      );
    }
  } finally {
    cancelled.value.release();
  }

  return Result.ok({ status: "cancelled", session: session.value });
}
