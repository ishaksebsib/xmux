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
  return Result.map(
    await input.ctx.store.workspaces.get(input.thread),
    (workspace) => workspace?.cwd ?? input.ctx.config.defaultWorkingDirectory,
  );
}

/** Resolves a path from the current thread cwd and verifies it is a directory. */
export async function resolveDirectoryForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ResolveDirectoryForThreadInput<TAdapters, TChats>,
): Promise<Result<string, ResolveDirectoryForThreadError>> {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(getCurrentWorkspaceCwd(input));
    const resolved = yield* Result.await(
      resolveDirectory({ fs: input.ctx.fs, baseCwd: cwd, inputPath: input.path }),
    );
    return Result.ok(resolved);
  });
}
