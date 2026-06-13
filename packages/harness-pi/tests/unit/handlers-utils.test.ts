import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { normalizePiAdapterConfig } from "../../src/config";
import type { PiRuntime, PiSessionHandle } from "../../src/runtime";
import { deleteSession } from "../../src/handlers/delete-session";
import { mapLiveSession, mapPiSessionInfo, resolvePiSession } from "../../src/handlers/utils";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-utils-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createRuntime(): PiRuntime {
  const sessions = new Map<string, PiSessionHandle>();
  return {
    config: normalizePiAdapterConfig({ sessionDir: join(tempDir, "sessions") }),
    sessions,
    close: async () => {
      sessions.clear();
    },
  };
}

function createHandle(sessionId: string): PiSessionHandle {
  return {
    session: {
      sessionId,
      sessionFile: join(tempDir, "live.jsonl"),
      sessionName: "Live session",
      model: { provider: "faux", id: "faux-fast" },
      messages: [1, 2],
      dispose: vi.fn(),
    } as unknown as AgentSession,
    cwd: process.cwd(),
    sessionId,
    sessionFile: join(tempDir, "live.jsonl"),
    sessionDir: join(tempDir, "sessions"),
    agentDir: join(tempDir, "agent"),
    dispose: vi.fn(),
  };
}

async function writeSessionFile(id: string, suffix: string) {
  const sessionDir = join(tempDir, "sessions");
  const sessionFile = join(sessionDir, `${Date.now()}_${id}_${suffix}.jsonl`);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-02T03:04:05.000Z",
      cwd: process.cwd(),
    })}\n`,
  );
  return sessionFile;
}

describe("Pi handler utilities", () => {
  test("session resolver finds live sessions first", async () => {
    const runtime = createRuntime();
    const handle = createHandle("session-1");
    runtime.sessions.set(handle.sessionId, handle);

    const resolved = await resolvePiSession({
      runtime,
      operation: "getSession",
      sessionId: handle.sessionId,
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved.unwrap("resolved").handle).toBe(handle);
  });

  test("live session wins over disk matches", async () => {
    const runtime = createRuntime();
    const handle = createHandle("session-1");
    runtime.sessions.set(handle.sessionId, handle);
    await writeSessionFile("session-1", "disk");

    const resolved = await resolvePiSession({
      runtime,
      operation: "getSession",
      sessionId: handle.sessionId,
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved.unwrap("resolved").handle).toBe(handle);
  });

  test("session resolver detects not found", async () => {
    const resolved = await resolvePiSession({
      runtime: createRuntime(),
      operation: "getSession",
      sessionId: "missing",
    });

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error.message).toContain("Pi session not found");
    }
  });

  test("explicit sessionPath rejects mismatched header id", async () => {
    const sessionPath = await writeSessionFile("actual-id", "explicit");

    const resolved = await resolvePiSession({
      runtime: createRuntime(),
      operation: "resumeSession",
      sessionId: "requested-id",
      adapterOptions: { sessionPath },
    });

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error.message).toContain("Pi session not found");
    }
  });

  test("invalid explicit sessionPath extension rejects", async () => {
    const resolved = await resolvePiSession({
      runtime: createRuntime(),
      operation: "resumeSession",
      sessionId: "session-1",
      adapterOptions: { sessionPath: join(tempDir, "session.txt") },
    });

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error.message).toContain(".jsonl");
    }
  });

  test("session resolver detects ambiguous matches", async () => {
    await writeSessionFile("ambiguous", "a");
    await writeSessionFile("ambiguous", "b");

    const resolved = await resolvePiSession({
      runtime: createRuntime(),
      operation: "getSession",
      sessionId: "ambiguous",
    });

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error.message).toContain("ambiguous");
    }
  });

  test("deleting a live session disposes it once and removes it from runtime", async () => {
    const runtime = createRuntime();
    const handle = createHandle("live-delete");
    runtime.sessions.set(handle.sessionId, handle);

    const deleted = await deleteSession(runtime, {
      ref: { harnessId: "pi", sessionId: handle.sessionId },
      adapterOptions: {},
    });

    expect(deleted.isOk()).toBe(true);
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(runtime.sessions.has(handle.sessionId)).toBe(false);
  });

  test("mappers produce stable Pi session metadata", async () => {
    const live = mapLiveSession(createHandle("live-session"));
    expect(live).toMatchObject({
      sessionId: "live-session",
      title: "Live session",
      model: { providerId: "faux", modelId: "faux-fast" },
      adapterData: {
        name: "Live session",
        messageCount: 2,
      },
    });

    const sessionFile = await writeSessionFile("disk-session", "single");
    const resolved = await resolvePiSession({
      runtime: createRuntime(),
      operation: "getSession",
      sessionId: "disk-session",
    });
    expect(resolved.isOk()).toBe(true);
    const info = resolved.unwrap("resolved").info;
    expect(info).toBeDefined();
    expect(mapPiSessionInfo(info!)).toMatchObject({
      sessionId: "disk-session",
      cwd: process.cwd(),
      adapterData: {
        sessionFile,
        sessionDir: join(tempDir, "sessions"),
        messageCount: 0,
        created: "2026-01-02T03:04:05.000Z",
        modified: "2026-01-02T03:04:05.000Z",
      },
    });
  });
});
