import { HarnessAdapterRespondInteractionError, createHarness } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../../src";
import { collectAsync } from "../fixtures/collect";
import { event, permissionAsked, questionAsked, sessionIdle } from "../fixtures/events";
import { startFakeOpenCodeServer } from "../fixtures/fake-opencode-server";

function createOpenCodeHarness(baseUrl: string) {
  return createHarness({
    adapters: {
      opencode: createOpenCodeAdapter({ mode: "external", baseUrl }),
    },
  });
}

describe("OpenCode interaction contract", () => {
  test.each([
    ["allow_once", "once"],
    ["allow_always", "always"],
    ["reject", "reject"],
  ] as const)("maps permission decision %s to OpenCode reply %s", async (decision, reply) => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const responded = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        adapterOptions: { workspace: "workspace-1" },
        response: { kind: "permission", requestId: "permission-1", decision },
      });

      expect(responded.isOk()).toBe(true);
      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/permission/permission-1/reply",
          query: expect.objectContaining({ directory: process.cwd(), workspace: "workspace-1" }),
          body: expect.objectContaining({ reply }),
        }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("maps question answers and rejections to OpenCode question routes", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const answered = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        adapterOptions: { workspace: "workspace-1" },
        response: { kind: "question", requestId: "question-1", answers: [["Yes"], ["A", "B"]] },
      });
      const rejected = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        adapterOptions: { workspace: "workspace-1" },
        response: { kind: "question", requestId: "question-2", reject: true },
      });

      expect(answered.isOk()).toBe(true);
      expect(rejected.isOk()).toBe(true);
      expect(fakeOpenCode.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            path: "/question/question-1/reply",
            body: { answers: [["Yes"], ["A", "B"]] },
          }),
          expect.objectContaining({ method: "POST", path: "/question/question-2/reject" }),
        ]),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps interaction request failures at the public boundary", async () => {
    const harness = createOpenCodeHarness("http://127.0.0.1:1");

    try {
      const responded = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      });

      expect(responded.isErr()).toBe(true);
      if (responded.isErr())
        expect(responded.error).toBeInstanceOf(HarnessAdapterRespondInteractionError);
    } finally {
      await harness.close();
    }
  });

  test("wraps bad interaction responses at the public boundary", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.forceResponse("POST", "/permission/permission-1/reply", {
      status: 404,
      body: { name: "NotFoundError", data: { message: "missing" } },
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const responded = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      });

      expect(responded.isErr()).toBe(true);
      if (responded.isErr())
        expect(responded.error.name).toBe("HarnessAdapterRespondInteractionError");
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps false interaction confirmations", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.forceResponse("POST", "/permission/permission-1/reply", {
      status: 200,
      body: false,
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const responded = await harness.respondInteraction({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      });

      expect(responded.isErr()).toBe(true);
      if (responded.isErr())
        expect(responded.error).toBeInstanceOf(HarnessAdapterRespondInteractionError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("maps permission and question prompt events", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(
      permissionAsked("session-1", {
        id: "permission-1",
        metadata: { reason: "validation" },
        always: ["pnpm test"],
        tool: { messageID: "message-1", callID: "call-1" },
      }),
      event("permission.replied", {
        sessionID: "session-1",
        requestID: "permission-1",
        reply: "once",
      }),
      questionAsked("session-1"),
      event("question.replied", { sessionID: "session-1", requestID: "question-1" }),
      event("question.rejected", { sessionID: "session-1", requestID: "question-2" }),
      sessionIdle("session-1"),
    );
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "interact" }],
      });
      const events = await collectAsync(prompted.unwrap("prompt stream"));

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "interaction",
            kind: "permission",
            phase: "requested",
            requestId: "permission-1",
          }),
          expect.objectContaining({
            type: "interaction",
            kind: "permission",
            phase: "answered",
            requestId: "permission-1",
          }),
          expect.objectContaining({
            type: "interaction",
            kind: "question",
            phase: "requested",
            requestId: "question-1",
          }),
          expect.objectContaining({
            type: "interaction",
            kind: "question",
            phase: "answered",
            requestId: "question-1",
          }),
          expect.objectContaining({
            type: "interaction",
            kind: "question",
            phase: "rejected",
            requestId: "question-2",
          }),
        ]),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });
});
