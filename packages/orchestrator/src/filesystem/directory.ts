import { Result } from "better-result";
import type { FileSystemHost, FileSystemHostError } from "./host";
import { InvalidDirectoryError } from "./errors";

export type ResolveDirectoryError = FileSystemHostError | InvalidDirectoryError;

export interface ResolveDirectoryInput {
  readonly fs: FileSystemHost;
  readonly baseCwd: string;
  readonly inputPath: string;
}

/**
 * Resolves a path and verifies it exists as a directory.
 *
 * The returned path intentionally preserves the lexical spelling produced from the
 * configured/current cwd instead of canonicalizing via realpath. Workspace paths
 * are user-visible state: on macOS, realpath would rewrite `/tmp` to
 * `/private/tmp`, and symlinked workspace aliases would unexpectedly change in
 * replies, stored session cwd snapshots, and adapter inputs.
 */
export async function resolveDirectory(
  input: ResolveDirectoryInput,
): Promise<Result<string, ResolveDirectoryError>> {
  const resolved = input.fs.resolvePath({ baseCwd: input.baseCwd, inputPath: input.inputPath });

  return Result.gen(async function* () {
    const stat = yield* Result.await(input.fs.stat({ path: resolved }));

    return stat.type === "directory"
      ? Result.ok(resolved)
      : Result.err(new InvalidDirectoryError({ path: resolved, reason: "not_directory" }));
  });
}
