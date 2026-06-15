import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import type { FileSystemDirectoryEntry, FileSystemHostError } from "../../../filesystem";
import type { ChatThreadRef } from "../../../store";
import { resolveDirectoryForThread, type ResolveDirectoryForThreadError } from "../utils";

export type ListDirectoryForThreadError = ResolveDirectoryForThreadError | FileSystemHostError;

export interface ListDirectoryForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly path?: string;
}

export interface ListDirectoryForThreadOutput {
  readonly cwd: string;
  readonly entries: readonly FileSystemDirectoryEntry[];
  readonly totalEntryCount: number;
  readonly truncated: boolean;
}

/** Lists directory entries for a chat thread workspace. */
export async function listDirectoryForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ListDirectoryForThreadInput<TAdapters, TChats>,
): Promise<Result<ListDirectoryForThreadOutput, ListDirectoryForThreadError>> {
  return Result.gen(async function* () {
    const target = yield* Result.await(
      resolveDirectoryForThread({
        ctx: input.ctx.app,
        thread: input.thread,
        path: input.path?.trim() || ".",
      }),
    );
    const entries = yield* Result.await(input.ctx.app.fs.readdir({ path: target }));

    const visibleEntries = input.ctx.app.config.workspace.showHiddenFiles
      ? entries
      : entries.filter((entry) => !entry.name.startsWith("."));
    const sortedEntries = [...visibleEntries].sort(compareDirectoryEntry);
    const maxEntries = input.ctx.app.config.workspace.maxListEntries;
    const limitedEntries = sortedEntries.slice(0, maxEntries);

    return Result.ok({
      cwd: target,
      entries: limitedEntries,
      totalEntryCount: sortedEntries.length,
      truncated: sortedEntries.length > limitedEntries.length,
    });
  });
}

function compareDirectoryEntry(
  left: FileSystemDirectoryEntry,
  right: FileSystemDirectoryEntry,
): number {
  const leftRank = entryTypeRank(left);
  const rightRank = entryTypeRank(right);

  return leftRank === rightRank ? left.name.localeCompare(right.name) : leftRank - rightRank;
}

function entryTypeRank(entry: FileSystemDirectoryEntry): number {
  if (entry.type === "directory") {
    return 0;
  }

  return entry.type === "file" ? 1 : 2;
}
