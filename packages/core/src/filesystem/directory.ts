import { Result } from "better-result";
import type { FileSystemHost, FileSystemHostError } from "./host";
import { InvalidDirectoryError } from "./errors";

export type ResolveDirectoryError = FileSystemHostError | InvalidDirectoryError;

export interface ResolveDirectoryInput {
  readonly fs: FileSystemHost;
  readonly baseCwd: string;
  readonly inputPath: string;
}

/** Resolves a path and verifies it exists as a real directory. */
export async function resolveDirectory(
  input: ResolveDirectoryInput,
): Promise<Result<string, ResolveDirectoryError>> {
  const resolved = input.fs.resolvePath({ baseCwd: input.baseCwd, inputPath: input.inputPath });
  const real = await input.fs.realpath({ path: resolved });

  if (real.isErr()) {
    return Result.err(real.error);
  }

  const stats = await input.fs.stat({ path: real.value });

  if (stats.isErr()) {
    return Result.err(stats.error);
  }

  return stats.value.type === "directory"
    ? Result.ok(real.value)
    : Result.err(new InvalidDirectoryError({ path: real.value, reason: "not_directory" }));
}
