import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHarness } from "@xmux/harness-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPiAdapter } from "../../src";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-sessions-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function adapterOptions() {
  return {
    agentDir: join(tempDir, "agent"),
    sessionDir: join(tempDir, "sessions"),
    noTools: "all" as const,
  };
}

function createPiHarness() {
  return createHarness({
    adapters: {
      pi: createPiAdapter(),
    },
  });
}

async function writeSessionFile(args: { readonly id: string; readonly cwd: string }) {
  const sessionDir = join(tempDir, "sessions");
  const sessionFile = join(sessionDir, `${Date.now()}_${args.id}_${Math.random()}.jsonl`);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: args.id,
      timestamp: new Date().toISOString(),
      cwd: args.cwd,
    })}\n`,
  );
  return sessionFile;
}

describe("Pi session contract", () => {
  test("create, list, get, abort, and delete a live session", async () => {
    const harness = createPiHarness();

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        title: "Test session",
        adapterOptions: adapterOptions(),
      });

      expect(created.isOk()).toBe(true);
      const session = created.unwrap("session should be created");
      expect(session.ref.harnessId).toBe("pi");
      expect(session.adapterData.name).toBe("Test session");

      const listed = await harness.listSessions({
        harnessId: "pi",
        adapterOptions: adapterOptions(),
      });
      expect(listed.isOk()).toBe(true);
      expect(
        listed.unwrap("sessions").some((item) => item.ref.sessionId === session.ref.sessionId),
      ).toBe(true);

      const fetched = await harness.getSession({
        ref: session.ref,
        adapterOptions: adapterOptions(),
      });
      expect(fetched.isOk()).toBe(true);
      expect(fetched.unwrap("fetched").title).toBe("Test session");

      const aborted = await harness.abort({ ref: session.ref, adapterOptions: adapterOptions() });
      expect(aborted.isOk()).toBe(true);

      const deleted = await harness.deleteSession({
        ref: session.ref,
        adapterOptions: adapterOptions(),
      });
      expect(deleted.isOk()).toBe(true);

      const missing = await harness.getSession({
        ref: session.ref,
        adapterOptions: adapterOptions(),
      });
      expect(missing.isErr()).toBe(true);
    } finally {
      await harness.close();
    }
  });

  test("resume opens an existing Pi session file", async () => {
    const harness = createPiHarness();
    const sessionId = "resume-session";
    const sessionFile = await writeSessionFile({ id: sessionId, cwd: process.cwd() });

    try {
      const resumed = await harness.resumeSession({
        harnessId: "pi",
        sessionId,
        cwd: process.cwd(),
        adapterOptions: { ...adapterOptions(), sessionPath: sessionFile },
      });

      expect(resumed.isOk()).toBe(true);
      const session = resumed.unwrap("session should resume");
      expect(session.ref).toEqual({ harnessId: "pi", sessionId });
      expect(session.adapterData.sessionFile).toBe(sessionFile);
    } finally {
      await harness.close();
    }
  });

  test("delete removes a filesystem-backed Pi session", async () => {
    const harness = createPiHarness();
    const sessionId = "delete-session";
    const sessionFile = await writeSessionFile({ id: sessionId, cwd: process.cwd() });

    try {
      const deleted = await harness.deleteSession({
        ref: { harnessId: "pi", sessionId },
        adapterOptions: { ...adapterOptions(), sessionPath: sessionFile },
      });

      expect(deleted.isOk()).toBe(true);
      const listed = await harness.listSessions({
        harnessId: "pi",
        adapterOptions: adapterOptions(),
      });
      expect(listed.isOk()).toBe(true);
      expect(listed.unwrap("sessions").some((item) => item.ref.sessionId === sessionId)).toBe(
        false,
      );
    } finally {
      await harness.close();
    }
  });

  test("missing session returns a typed harness error", async () => {
    const harness = createPiHarness();

    try {
      const result = await harness.getSession({
        ref: { harnessId: "pi", sessionId: "missing" },
        adapterOptions: adapterOptions(),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain("Failed to get session");
        expect(JSON.stringify(result.error)).toContain("Pi session not found");
      }
    } finally {
      await harness.close();
    }
  });
});
