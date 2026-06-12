import {
  HarnessAdapterCreateSessionError,
  HarnessAdapterDeleteSessionError,
  HarnessAdapterListSessionsError,
  createHarness,
} from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../../src";
import { nativeSession } from "../fixtures/builders";
import { startFakeOpenCodeServer } from "../fixtures/fake-opencode-server";

function createOpenCodeHarness(baseUrl: string) {
  return createHarness({
    adapters: {
      opencode: createOpenCodeAdapter({ mode: "external", baseUrl }),
    },
  });
}

describe("OpenCode session contract", () => {
  test("creates sessions through the public harness and maps OpenCode session data", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "contract session",
        model: { providerId: "provider-1", modelId: "model-1", variant: "fast" },
        adapterOptions: { parentId: "parent-1", workspace: "workspace-1" },
      });

      expect(created.isOk()).toBe(true);
      const session = created.unwrap("created session");
      expect(session).toMatchObject({
        ref: { harnessId: "opencode" },
        cwd: process.cwd(),
        title: "contract session",
        model: { providerId: "provider-1", modelId: "model-1", variant: "fast" },
        adapterData: { directory: process.cwd(), projectId: "project-1" },
      });

      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/session",
          query: expect.objectContaining({ directory: process.cwd(), workspace: "workspace-1" }),
          body: expect.objectContaining({
            title: "contract session",
            parentID: "parent-1",
            model: { providerID: "provider-1", id: "model-1", variant: "fast" },
          }),
        }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("gets, resumes, and lists sessions with native title/cwd/model metadata", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer({
      sessions: [
        nativeSession({
          id: "session-1",
          title: "native title",
          directory: process.cwd(),
          model: { providerID: "provider-native", id: "model-native", variant: "slow" },
        }),
      ],
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const resumed = await harness.resumeSession({
        harnessId: "opencode",
        sessionId: "session-1",
        cwd: process.cwd(),
      });
      const found = await harness.getSession({
        ref: { harnessId: "opencode", sessionId: "session-1" },
      });
      const listed = await harness.listSessions({ harnessId: "opencode", cwd: process.cwd() });

      expect(resumed.unwrap("resumed")).toMatchObject({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        title: "native title",
        cwd: process.cwd(),
        model: { providerId: "provider-native", modelId: "model-native", variant: "slow" },
      });
      expect(found.unwrap("found")).toMatchObject({ title: "native title" });
      expect(listed.unwrap("listed")).toEqual([
        expect.objectContaining({ ref: { harnessId: "opencode", sessionId: "session-1" } }),
      ]);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("deletes and aborts sessions through OpenCode routes", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer({
      sessions: [nativeSession({ id: "session-1" })],
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const deleted = await harness.deleteSession({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        adapterOptions: { workspace: "workspace-1" },
      });
      const aborted = await harness.abort({
        ref: { harnessId: "opencode", sessionId: "session-2" },
        adapterOptions: { workspace: "workspace-1" },
      });

      expect(deleted.isOk()).toBe(true);
      expect(aborted.isOk()).toBe(true);
      expect(fakeOpenCode.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "DELETE",
            path: "/session/session-1",
            query: { workspace: "workspace-1" },
          }),
          expect.objectContaining({
            method: "POST",
            path: "/session/session-2/abort",
            query: { workspace: "workspace-1" },
          }),
        ]),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps request failures at the public boundary", async () => {
    const harness = createOpenCodeHarness("http://127.0.0.1:1");

    try {
      const created = await harness.createSession({ harnessId: "opencode", cwd: process.cwd() });

      expect(created.isErr()).toBe(true);
      if (created.isErr()) expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
    } finally {
      await harness.close();
    }
  });

  test("wraps OpenCode response failures at the public boundary", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.forceResponse("POST", "/session", {
      status: 500,
      body: { name: "InternalError", data: { message: "boom" } },
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const created = await harness.createSession({ harnessId: "opencode", cwd: process.cwd() });

      expect(created.isErr()).toBe(true);
      if (created.isErr()) expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps structured { error } response bodies", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.forceResponse("POST", "/session", {
      status: 500,
      body: { error: { name: "InternalError", data: { message: "boom" } } },
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const created = await harness.createSession({ harnessId: "opencode", cwd: process.cwd() });

      expect(created.isErr()).toBe(true);
      if (created.isErr()) expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps malformed/missing session list data responses", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.forceResponse("GET", "/session", {
      status: 200,
      body: {},
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const listed = await harness.listSessions({ harnessId: "opencode" });

      expect(listed.isErr()).toBe(true);
      if (listed.isErr()) expect(listed.error).toBeInstanceOf(HarnessAdapterListSessionsError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps boolean endpoints returning false", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer({
      sessions: [nativeSession({ id: "session-1" })],
    });
    fakeOpenCode.forceResponse("DELETE", "/session/session-1", {
      status: 200,
      body: false,
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const deleted = await harness.deleteSession({
        ref: { harnessId: "opencode", sessionId: "session-1" },
      });

      expect(deleted.isErr()).toBe(true);
      if (deleted.isErr()) expect(deleted.error).toBeInstanceOf(HarnessAdapterDeleteSessionError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });
});
