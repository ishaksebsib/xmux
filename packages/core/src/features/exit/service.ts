import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, SessionRef } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef } from "../../store";

export type ExitActiveSessionError = StoreError;

export type ExitActiveSessionOutput =
  | { readonly status: "exited"; readonly session: ExitedSessionSummary }
  | { readonly status: "not_active" };

export interface ExitedSessionSummary {
  readonly ref: SessionRef;
  readonly title?: string;
  readonly cwd?: string;
}

export interface ExitActiveSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

/** Detaches a chat thread from its active session without touching the harness session. */
export async function exitActiveSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ExitActiveSessionForThreadInput<TAdapters, TChats>,
): Promise<Result<ExitActiveSessionOutput, ExitActiveSessionError>> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.ok({ status: "not_active" });
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const deleted = await input.ctx.app.store.threadBindings.delete(input.thread);

  if (deleted.isErr()) {
    return Result.err(deleted.error);
  }

  return Result.ok({
    status: "exited",
    session: {
      ref: binding.value.sessionRef,
      ...(session.value?.title === undefined ? {} : { title: session.value.title }),
      ...(session.value?.cwd === undefined ? {} : { cwd: session.value.cwd }),
    },
  });
}
