import type { WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createSession } from "../src/handlers/create-session";
import { getSession } from "../src/handlers/get-session";
import { listSessions } from "../src/handlers/list-sessions";
import { resumeSession } from "../src/handlers/resume-session";
import type { OpenCodeRuntime } from "../src/runtime";

function createNativeSession(args: { readonly id: string; readonly title: string }) {
  return {
    id: args.id,
    slug: `${args.id}-slug`,
    projectID: "project-1",
    directory: process.cwd(),
    title: args.title,
    version: "1.0.0",
    time: { created: 1, updated: 1 },
  };
}

describe("OpenCode session handlers", () => {
  test("creates sessions with OpenCode create inputs", async () => {
    const calls: unknown[] = [];
    const runtime = {
      client: {
        session: {
          create: async (parameters: unknown) => {
            calls.push(parameters);
            return { data: createNativeSession({ id: "session-1", title: "created" }) };
          },
        },
      },
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const created = await createSession(runtime, {
      cwd: process.cwd() as WorkingDirectoryPath,
      title: "created",
      adapterOptions: { workspace: "default", parentId: "parent-1" },
    });

    expect(created.isOk()).toBe(true);
    expect(created.unwrap("created")).toMatchObject({
      sessionId: "session-1",
      adapterData: { directory: process.cwd(), projectId: "project-1" },
    });
    expect(calls[0]).toMatchObject({
      directory: process.cwd(),
      parentID: "parent-1",
      title: "created",
      workspace: "default",
    });
  });

  test("returns native title/cwd when resuming, getting, and listing sessions", async () => {
    const runtime = {
      client: {
        session: {
          get: async ({ sessionID }: { readonly sessionID: string }) => ({
            data: createNativeSession({ id: sessionID, title: `${sessionID} title` }),
          }),
          list: async () => ({
            data: [createNativeSession({ id: "session-1", title: "listed title" })],
          }),
        },
      },
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const resumed = await resumeSession(runtime, {
      sessionId: "session-1",
      cwd: process.cwd() as WorkingDirectoryPath,
      adapterOptions: {},
    });
    const found = await getSession(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-2" },
      adapterOptions: {},
    });
    const listed = await listSessions(runtime, { adapterOptions: {} });

    expect(resumed.isOk()).toBe(true);
    expect(found.isOk()).toBe(true);
    expect(listed.isOk()).toBe(true);
    expect(resumed.unwrap("resumed")).toMatchObject({
      sessionId: "session-1",
      cwd: process.cwd(),
      title: "session-1 title",
    });
    expect(found.unwrap("found")).toMatchObject({
      sessionId: "session-2",
      cwd: process.cwd(),
      title: "session-2 title",
    });
    expect(listed.unwrap("listed")[0]).toMatchObject({
      sessionId: "session-1",
      cwd: process.cwd(),
      title: "listed title",
    });
  });
});
