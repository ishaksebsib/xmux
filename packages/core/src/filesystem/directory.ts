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

  return Result.gen(async function* () {
    const real = yield* Result.await(input.fs.realpath({ path: resolved }));
    const stat = yield* Result.await(input.fs.stat({ path: real }));

    return stat.type === "directory"
      ? Result.ok(real)
      : Result.err(new InvalidDirectoryError({ path: real, reason: "not_directory" }));
  });
}
