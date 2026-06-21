import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeConfig, parseXmuxConfig } from "../src/config";
import {
  createNodeFileSystemHost,
  FileSystemPathNotFoundError,
  InvalidDirectoryError,
  resolveDirectory,
} from "../src/filesystem";

describe("workspace filesystem", () => {
  test("normalizes workspace config defaults safely", () => {
    const config = normalizeConfig({
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
    });

    expect(config.workspace).toEqual({ showHiddenFiles: false, maxListEntries: 100 });
    expect(config.model).toEqual({ maxModelsPerProvider: 10 });
    expect(config.prompt.response).toEqual({
      showToolOutput: true,
      maxToolTextOutputChars: 280,
      maxToolJsonOutputChars: 400,
      maxReasoningChars: 320,
      maxToolInputStringChars: 50,
      maxToolInputObjectEntries: 2,
    });
    expect(config.prompt.attachments).toEqual({
      enabled: true,
      maxBytes: 10 * 1024 * 1024,
      kinds: ["image", "audio", "video", "document", "archive", "other"],
    });
  });

  test("normalizes prompt attachment config", () => {
    const config = normalizeConfig({
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
      prompt: {
        attachments: {
          enabled: false,
          maxBytes: 42,
          kinds: ["image", "document", "image"],
        },
      },
    });

    expect(config.prompt.attachments).toEqual({
      enabled: false,
      maxBytes: 42,
      kinds: ["image", "document"],
    });
  });

  test("normalizes prompt response config", () => {
    const config = normalizeConfig({
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
      prompt: {
        response: {
          showToolOutput: false,
          maxToolTextOutputChars: 10,
          maxToolJsonOutputChars: 11,
          maxReasoningChars: 12,
          maxToolInputStringChars: 13,
          maxToolInputObjectEntries: 2,
          maxStreamDeltaChars: 14,
        },
      },
    });

    expect(config.prompt.response).toEqual({
      showToolOutput: false,
      maxToolTextOutputChars: 10,
      maxToolJsonOutputChars: 11,
      maxReasoningChars: 12,
      maxToolInputStringChars: 13,
      maxToolInputObjectEntries: 2,
      maxStreamDeltaChars: 14,
    });
  });

  test("rejects malformed prompt response limits", () => {
    const config = parseXmuxConfig({
      defaultWorkingDirectory: ".",
      deliveryMode: "requester_only",
      prompt: {
        response: {
          maxToolTextOutputChars: 0,
        },
      },
    });

    expect(config.isErr()).toBe(true);
    if (config.isErr()) {
      expect(config.error.message).toContain("prompt.response.maxToolTextOutputChars");
    }
  });

  test("resolves a relative directory from a base cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "xmux-fs-"));

    try {
      await mkdir(join(root, "packages", "orchestrator"), { recursive: true });
      const fs = createNodeFileSystemHost();
      const resolved = await resolveDirectory({
        fs,
        baseCwd: root,
        inputPath: "packages/orchestrator",
      });

      expect(resolved.unwrap("expected directory resolution to succeed")).toBe(
        join(root, "packages", "orchestrator"),
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
