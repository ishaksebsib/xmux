import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Context } from "../../ctx";
import { resolveDirectory, type ResolveDirectoryError } from "../../filesystem";
import type { StoreOperationError } from "../../errors";
import type { ChatThreadRef } from "../../store";

export type GetCurrentWorkspaceCwdError = StoreOperationError;
export type ResolveDirectoryForThreadError = GetCurrentWorkspaceCwdError | ResolveDirectoryError;

export interface GetCurrentWorkspaceCwdInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: Context<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

export interface ResolveDirectoryForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> extends GetCurrentWorkspaceCwdInput<TAdapters, TChats> {
  readonly path: string;
}

/** Returns the stored thread cwd or the configured default cwd. */
export async function getCurrentWorkspaceCwd<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: GetCurrentWorkspaceCwdInput<TAdapters, TChats>,
): Promise<Result<string, GetCurrentWorkspaceCwdError>> {
  const workspace = await input.ctx.store.workspaces.get(input.thread);

  if (workspace.isErr()) {
    return Result.err(workspace.error);
  }

  return Result.ok(workspace.value?.cwd ?? input.ctx.config.defaultWorkingDirectory);
}

/** Resolves a path from the current thread cwd and verifies it is a directory. */
export async function resolveDirectoryForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ResolveDirectoryForThreadInput<TAdapters, TChats>,
): Promise<Result<string, ResolveDirectoryForThreadError>> {
  const cwd = await getCurrentWorkspaceCwd(input);

  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  return resolveDirectory({ fs: input.ctx.fs, baseCwd: cwd.value, inputPath: input.path });
}
