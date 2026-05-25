import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config";
import {
  createNodeFileSystemHost,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
  resolveDirectory,
} from "../src/filesystem";

describe("workspace filesystem", () => {
  test("normalizes workspace config defaults safely", () => {
    const config = normalizeConfig({
      userName: "xmux",
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
    });

    expect(config.workspace).toEqual({ showHiddenFiles: false, maxListEntries: 100 });
    expect(config.model).toEqual({ maxModelsPerProvider: 10 });
  });

  test("resolves a relative directory from a base cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-fs-"));

    try {
      await mkdir(join(root, "packages", "core"), { recursive: true });
      const fs = createNodeFileSystemHost();
      const resolved = await resolveDirectory({
        fs,
        baseCwd: root,
        inputPath: "packages/core",
      });

      expect(resolved.unwrap("expected directory resolution to succeed")).toBe(
        join(root, "packages", "core"),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("returns typed errors for missing and non-directory targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-fs-"));

    try {
      await writeFile(join(root, "README.md"), "hello");
      const fs = createNodeFileSystemHost();

      const missing = await resolveDirectory({ fs, baseCwd: root, inputPath: "missing" });
      const file = await resolveDirectory({ fs, baseCwd: root, inputPath: "README.md" });

      expect(missing.isErr() && FileSystemPathNotFoundError.is(missing.error)).toBe(true);
      expect(file.isErr() && InvalidDirectoryError.is(file.error)).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
