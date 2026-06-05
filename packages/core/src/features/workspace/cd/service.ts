import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import type { StoreOperationError } from "../../../errors";
import type { ChatThreadRef, ThreadWorkspace } from "../../../store";
import { createThreadWorkspace } from "../../../store";
import { resolveDirectoryForThread, type ResolveDirectoryForThreadError } from "../utils";

export type ChangeDirectoryForThreadError = ResolveDirectoryForThreadError | StoreOperationError;

export interface ChangeDirectoryForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly path: string;
}

/** Changes the stored workspace directory for a chat thread. */
export async function changeDirectoryForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ChangeDirectoryForThreadInput<TAdapters, TChats>,
): Promise<Result<ThreadWorkspace, ChangeDirectoryForThreadError>> {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(
      resolveDirectoryForThread({
        ctx: input.ctx.app,
        thread: input.thread,
        path: input.path,
      }),
    );
    const existing = yield* Result.await(input.ctx.app.store.workspaces.get(input.thread));

    const now = input.ctx.app.services.now().toISOString();
    const workspace = existing
      ? { ...existing, cwd, updatedAt: now }
      : createThreadWorkspace({ thread: input.thread, cwd, now });

    return Result.ok(yield* Result.await(input.ctx.app.store.workspaces.set(workspace)));
  });
}
