import type { WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { abortSession } from "../src/handlers/abort";
import { createSession } from "../src/handlers/create-session";
import { deleteSession } from "../src/handlers/delete-session";
import { getSession } from "../src/handlers/get-session";
import { listSessions } from "../src/handlers/list-sessions";
import { resumeSession } from "../src/handlers/resume-session";
import type { OpenCodeRuntime } from "../src/runtime";

function createNativeSession(args: {
  readonly id: string;
  readonly title: string;
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string };
}) {
  return {
    id: args.id,
    slug: `${args.id}-slug`,
    projectID: "project-1",
    directory: process.cwd(),
    title: args.title,
    model: args.model,
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
      sessionModels: new Map(),
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const created = await createSession(runtime, {
      cwd: process.cwd() as WorkingDirectoryPath,
      title: "created",
      model: { providerId: "provider-1", modelId: "model-1", variant: "fast" },
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
      model: { providerID: "provider-1", id: "model-1", variant: "fast" },
    });
  });

  test("deletes and aborts sessions through OpenCode", async () => {
    const calls: string[] = [];
    const sessionModels = new Map([
      ["session-1", { providerId: "provider-1", modelId: "model-1" }],
    ]);
    const runtime = {
      client: {
        session: {
          delete: async (parameters: {
            readonly sessionID: string;
            readonly workspace?: string;
          }) => {
            calls.push(`delete:${parameters.sessionID}:${parameters.workspace}`);
            return { data: true, response: { status: 200 } };
          },
          abort: async (parameters: {
            readonly sessionID: string;
            readonly workspace?: string;
          }) => {
            calls.push(`abort:${parameters.sessionID}:${parameters.workspace}`);
            return { data: true, response: { status: 200 } };
          },
        },
      },
      sessionModels,
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const deleted = await deleteSession(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      adapterOptions: { workspace: "default" },
    });
    const aborted = await abortSession(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-2" },
      adapterOptions: { workspace: "default" },
    });

    expect(deleted.isOk()).toBe(true);
    expect(aborted.isOk()).toBe(true);
    expect(calls).toEqual(["delete:session-1:default", "abort:session-2:default"]);
    expect(sessionModels.has("session-1")).toBe(false);
  });

  test("returns native title/cwd when resuming, getting, and listing sessions", async () => {
    const runtime = {
      client: {
        session: {
          get: async ({ sessionID }: { readonly sessionID: string }) => ({
            data: createNativeSession({
              id: sessionID,
              title: `${sessionID} title`,
              model: { providerID: "native-provider", id: "native-model", variant: "slow" },
            }),
          }),
          list: async () => ({
            data: [
              createNativeSession({
                id: "session-1",
                title: "listed title",
                model: { providerID: "native-provider", id: "native-model", variant: "slow" },
              }),
            ],
          }),
        },
      },
      defaultModel: undefined,
      sessionModels: new Map(),
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
      model: { providerId: "native-provider", modelId: "native-model", variant: "slow" },
    });
    expect(found.unwrap("found")).toMatchObject({
      sessionId: "session-2",
      cwd: process.cwd(),
      title: "session-2 title",
      model: { providerId: "native-provider", modelId: "native-model", variant: "slow" },
    });
    expect(listed.unwrap("listed")[0]).toMatchObject({
      sessionId: "session-1",
      cwd: process.cwd(),
      title: "listed title",
      model: { providerId: "native-provider", modelId: "native-model", variant: "slow" },
    });
  });
});
