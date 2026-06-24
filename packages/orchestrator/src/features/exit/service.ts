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
  return Result.gen(async function* () {
    const binding = yield* Result.await(input.ctx.app.store.threadBindings.get(input.thread));

    if (!binding) return Result.ok({ status: "not_active" } as const);

    const session = yield* Result.await(input.ctx.app.store.sessions.get(binding.sessionRef));
    yield* Result.await(input.ctx.app.store.threadBindings.delete(input.thread));
    input.ctx.app.services.promptQueue.clearThread(input.thread);

    return Result.ok({
      status: "exited" as const,
      session: {
        ref: binding.sessionRef,
        ...(session?.title === undefined ? {} : { title: session.title }),
        ...(session?.cwd === undefined ? {} : { cwd: session.cwd }),
      },
    });
  });
}
