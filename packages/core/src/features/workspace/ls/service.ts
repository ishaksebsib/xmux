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
  const target = await resolveDirectoryForThread({
    ctx: input.ctx.app,
    thread: input.thread,
    path: input.path?.trim() || ".",
  });

  if (target.isErr()) {
    return Result.err(target.error);
  }

  const entries = await input.ctx.app.fs.readdir({ path: target.value });

  if (entries.isErr()) {
    return Result.err(entries.error);
  }

  const visibleEntries = input.ctx.app.config.workspace.showHiddenFiles
    ? entries.value
    : entries.value.filter((entry) => !entry.name.startsWith("."));
  const sortedEntries = [...visibleEntries].sort(compareDirectoryEntry);
  const maxEntries = input.ctx.app.config.workspace.maxListEntries;
  const limitedEntries = sortedEntries.slice(0, maxEntries);

  return Result.ok({
    cwd: target.value,
    entries: limitedEntries,
    totalEntryCount: sortedEntries.length,
    truncated: sortedEntries.length > limitedEntries.length,
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
