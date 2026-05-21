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
  const cwd = await resolveDirectoryForThread({
    ctx: input.ctx.app,
    thread: input.thread,
    path: input.path,
  });

  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  const existing = await input.ctx.app.store.workspaces.get(input.thread);

  if (existing.isErr()) {
    return Result.err(existing.error);
  }

  const now = input.ctx.app.services.now().toISOString();
  const workspace = existing.value
    ? { ...existing.value, cwd: cwd.value, updatedAt: now }
    : createThreadWorkspace({ thread: input.thread, cwd: cwd.value, now });

  return input.ctx.app.store.workspaces.set(workspace);
}
