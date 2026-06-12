import { createHarness } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../../src";
import { collectAsync } from "../fixtures/collect";
import {
  event,
  nextReasoningSequence,
  nextStepEnded,
  nextStepStarted,
  nextTextSequence,
  nextToolFailedSequence,
  nextToolSuccessSequence,
  sessionIdle,
  wrapped,
} from "../fixtures/events";
import { startFakeOpenCodeServer } from "../fixtures/fake-opencode-server";

function createOpenCodeHarness(baseUrl: string) {
  return createHarness({
    adapters: {
      opencode: createOpenCodeAdapter({ mode: "external", baseUrl }),
    },
  });
}

describe("OpenCode prompt stream contract", () => {
  test("streams text, reasoning, tool, retry, compaction, and terminal events through harness.prompt", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(
      wrapped(nextStepStarted("session-1")),
      event("session.next.text.delta", { sessionID: "other-session", delta: "ignore me" }),
      ...nextTextSequence("session-1", "hello"),
      ...nextReasoningSequence("session-1", "reasoning-1", "because"),
      ...nextToolSuccessSequence("session-1", "call-1", "bash", { command: "pwd" }, "ok"),
      ...nextToolFailedSequence(
        "session-1",
        "call-2",
        "read",
        { file: "missing" },
        { message: "not found" },
      ),
      event("session.next.retried", { sessionID: "session-1", attempt: 2, error: "try again" }),
      event("session.next.compaction.started", {
        sessionID: "session-1",
        timestamp: 50,
        reason: "manual",
      }),
      event("session.next.compaction.delta", {
        sessionID: "session-1",
        timestamp: 51,
        text: "summary",
      }),
      event("session.next.compaction.ended", {
        sessionID: "session-1",
        timestamp: 52,
        text: "summary",
      }),
      nextStepEnded("session-1"),
      sessionIdle("session-1"),
    );
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "Say hello" }],
      });

      expect(prompted.isOk()).toBe(true);
      const events = await collectAsync(prompted.unwrap("prompt stream"));

      expect(events[0]).toMatchObject({ type: "run", phase: "started" });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "turn", phase: "started", agent: "build" }),
          expect.objectContaining({
            type: "content",
            phase: "delta",
            kind: "text",
            delta: "hello",
          }),
          expect.objectContaining({
            type: "content",
            phase: "delta",
            kind: "reasoning",
            delta: "because",
          }),
          expect.objectContaining({ type: "tool", phase: "completed", callId: "call-1" }),
          expect.objectContaining({ type: "tool", phase: "failed", callId: "call-2" }),
          expect.objectContaining({ type: "retry", attempt: 2, error: "try again" }),
          expect.objectContaining({
            type: "content",
            phase: "completed",
            kind: "compaction",
            text: "summary",
          }),
          expect.objectContaining({ type: "run", phase: "completed", reason: "stop" }),
        ]),
      );
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "content", phase: "delta", delta: "ignore me" }),
        ]),
      );
      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({ method: "POST", path: "/session/session-1/prompt_async" }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("sends normalized prompt content parts through the public harness path", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(sessionIdle("session-1"));
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "aW1n", mimeType: "image/png", name: "img.png" },
          { type: "file", uri: "file:///tmp/readme.md", mime: "text/markdown", name: "readme.md" },
        ],
      });

      expect(prompted.isOk()).toBe(true);
      await collectAsync(prompted.unwrap("prompt stream"));
      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/session/session-1/prompt_async",
          body: expect.objectContaining({
            parts: [
              { type: "text", text: "hello" },
              {
                type: "file",
                mime: "image/png",
                filename: "img.png",
                url: "data:image/png;base64,aW1n",
              },
              {
                type: "file",
                mime: "text/plain",
                filename: "readme.md",
                url: "file:///tmp/readme.md",
              },
            ],
          }),
        }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("maps session.next.synthetic text into prompt content", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(
      event("session.next.synthetic", {
        sessionID: "session-1",
        timestamp: 10,
        text: "synthetic text",
      }),
      sessionIdle("session-1"),
    );
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "go" }],
      });
      const events = await collectAsync(prompted.unwrap("prompt stream"));

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "content",
            phase: "completed",
            kind: "text",
            text: "synthetic text",
          }),
        ]),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("session model switch updates prompt model selection", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(
      event("session.next.model.switched", {
        sessionID: "session-1",
        model: { providerID: "provider-2", id: "model-2", variant: "fast" },
      }),
      sessionIdle("session-1"),
    );
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "switch" }],
      });
      expect(prompted.isOk()).toBe(true);
      await collectAsync(prompted.unwrap("prompt stream"));

      const selected = await harness.getModel({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      });
      expect(selected.unwrap("selected")).toMatchObject({
        source: "session",
        model: { providerId: "provider-2", modelId: "model-2", variant: "fast" },
      });
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("maps OpenCode session errors and aborted errors to terminal run events", async () => {
    const failedServer = await startFakeOpenCodeServer();
    failedServer.enqueueEvents(
      event("session.error", { sessionID: "session-1", error: { name: "Error", message: "boom" } }),
    );
    const abortedServer = await startFakeOpenCodeServer();
    abortedServer.enqueueEvents(
      event("session.error", {
        sessionID: "session-1",
        error: { name: "MessageAbortedError", message: "aborted" },
      }),
    );

    const failedHarness = createOpenCodeHarness(failedServer.url);
    const abortedHarness = createOpenCodeHarness(abortedServer.url);

    try {
      const failed = await failedHarness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "fail" }],
      });
      const aborted = await abortedHarness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "abort" }],
      });

      expect((await collectAsync(failed.unwrap("failed"))).at(-1)).toMatchObject({
        type: "run",
        phase: "failed",
      });
      expect((await collectAsync(aborted.unwrap("aborted"))).at(-1)).toMatchObject({
        type: "run",
        phase: "aborted",
      });
    } finally {
      await failedHarness.close();
      await abortedHarness.close();
      await failedServer.close();
      await abortedServer.close();
    }
  });

  test("fails when the event stream ends before a terminal event", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.closeEventStreamsAfterQueuedEvents();
    fakeOpenCode.enqueueEvents(nextStepStarted("session-1"));
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "early close" }],
      });

      const events = await collectAsync(prompted.unwrap("prompt stream"));
      expect(events.at(-1)).toMatchObject({ type: "run", phase: "failed" });
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("user abort before prompt acceptance does not call the OpenCode abort route", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);
    const controller = new AbortController();
    controller.abort(new Error("user abort"));

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "abort" }],
        signal: controller.signal,
      });
      const events = await collectAsync(prompted.unwrap("prompt stream"));

      expect(events.at(-1)).toMatchObject({ type: "run", phase: "aborted" });
      expect(fakeOpenCode.requests).not.toContainEqual(
        expect.objectContaining({ method: "POST", path: "/session/session-1/abort" }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("user abort after prompt acceptance calls the OpenCode abort route", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(nextStepStarted("session-1"));
    const harness = createOpenCodeHarness(fakeOpenCode.url);
    const controller = new AbortController();

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "abort later" }],
        signal: controller.signal,
      });

      const iterator = prompted.unwrap("prompt stream")[Symbol.asyncIterator]();
      const first = await iterator.next();
      const second = await iterator.next();
      expect(first.value).toMatchObject({ type: "run", phase: "started" });
      expect(second.value).toMatchObject({ type: "turn", phase: "started" });

      controller.abort(new Error("user abort"));
      const third = await iterator.next();
      expect(third.value).toMatchObject({ type: "run", phase: "aborted" });
      await iterator.return?.();
      await fakeOpenCode.waitForRequest(
        (request) => request.method === "POST" && request.path === "/session/session-1/abort",
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });
});
