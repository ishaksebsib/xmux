import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distPath = (target: string): string => join(packageRoot, target.replace(/^\.\//, ""));

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

class PackagingCommandError extends Schema.TaggedErrorClass<PackagingCommandError>()(
  "PackagingCommandError",
  {
    message: Schema.String,
    command: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const runCommand = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}): Effect.Effect<CommandResult, PackagingCommandError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<CommandResult>((resolve, reject) => {
        const stdout: Array<string> = [];
        const stderr: Array<string> = [];
        const child = spawn(input.command, [...input.args], {
          cwd: input.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });

        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
        child.once("error", reject);
        child.once("exit", (exitCode) => {
          resolve({
            exitCode: exitCode ?? 1,
            stdout: stdout.join(""),
            stderr: stderr.join(""),
          });
        });
      }),
    catch: (cause) =>
      new PackagingCommandError({
        message: `Failed to run ${input.command}.`,
        command: input.command,
        cause,
      }),
  });

const collectStringTargets = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(collectStringTargets);
};

const expectFileExists = (target: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const file = distPath(target);
    const info = yield* Effect.promise(() => stat(file));
    expect(info.isFile(), file).toBe(true);
  });

describe("package metadata and dist artifacts", () => {
  it.effect("declares only the built dist package surface", () =>
    Effect.gen(function* () {
      expect(packageJson.bin).toEqual({ xmux: "./dist/bin/xmux.mjs" });
      expect(packageJson.files).toEqual(["dist"]);
      expect(packageJson.main).toBe("./dist/index.cjs");
      expect(packageJson.module).toBe("./dist/index.mjs");
      expect(packageJson.types).toBe("./dist/index.d.cts");

      const targets = [
        packageJson.main,
        packageJson.module,
        packageJson.types,
        packageJson.bin.xmux,
        ...collectStringTargets(packageJson.exports),
      ].filter((target) => target.startsWith("./dist/"));

      expect(targets).toContain("./dist/index.mjs");
      expect(targets).toContain("./dist/index.cjs");
      expect(targets).toContain("./dist/index.d.mts");
      expect(targets).toContain("./dist/index.d.cts");
      expect(targets).toContain("./dist/bin/xmux.mjs");

      for (const target of targets) {
        yield* expectFileExists(target);
      }
    }),
  );

  it.effect("builds executable bin artifacts with node shebangs", () =>
    Effect.gen(function* () {
      for (const target of ["./dist/bin/xmux.mjs", "./dist/bin/xmux.cjs"]) {
        const file = distPath(target);
        const content = yield* Effect.promise(() => readFile(file, "utf8"));
        const info = yield* Effect.promise(() => stat(file));

        expect(content.startsWith("#!/usr/bin/env node\n"), file).toBe(true);
        expect(info.mode & 0o111, file).not.toBe(0);
      }
    }),
  );

  it.live("packs only package metadata, license, and dist files", () =>
    Effect.gen(function* () {
      const packDir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-cli-pack-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );

      const pack = yield* runCommand({
        command: "pnpm",
        args: ["pack", "--pack-destination", packDir],
        cwd: packageRoot,
      });
      expect(pack.exitCode, `${pack.stdout}\n${pack.stderr}`).toBe(0);

      const files = yield* Effect.promise(() => readdir(packDir));
      const tarball = files.find((file) => file.endsWith(".tgz"));
      expect(tarball, `pack output files: ${files.join(", ")}`).toBeDefined();
      if (tarball === undefined) return;

      const listing = yield* runCommand({
        command: "tar",
        args: ["-tf", join(packDir, tarball)],
        cwd: packageRoot,
      });
      expect(listing.exitCode, `${listing.stdout}\n${listing.stderr}`).toBe(0);

      const entries = listing.stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .sort();

      expect(entries).toContain("package/package.json");
      expect(entries).toContain("package/LICENSE");
      expect(entries).toContain("package/dist/bin/xmux.mjs");
      expect(entries).toContain("package/dist/index.mjs");

      const unexpected = entries.filter((entry) => {
        if (entry === "package/package.json" || entry === "package/LICENSE") return false;
        return !entry.startsWith("package/dist/");
      });
      expect(unexpected).toEqual([]);

      const forbidden = entries.filter(
        (entry) =>
          entry.includes("/src/") ||
          entry.includes("/tests/") ||
          entry.includes("/.turbo/") ||
          basename(entry) === ".turbo",
      );
      expect(forbidden).toEqual([]);
    }),
  );
});
