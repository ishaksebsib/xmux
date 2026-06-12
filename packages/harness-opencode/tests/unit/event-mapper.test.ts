import { describe, expect, test } from "vitest";
import { mapOpenCodeEvent } from "../../src/prompt/event-mapper";
import { createPromptStreamState } from "../../src/prompt/state";
import { event, nextTextSequence, sessionIdle } from "../fixtures/events";
import type { OpenCodeRuntime } from "../../src/runtime";

const ref = { harnessId: "opencode", sessionId: "session-1" } as const;

function runtime(): OpenCodeRuntime {
  return {
    sessionModels: new Map(),
    sessionThinking: new Map(),
    thinkingLevelMap: {},
    close: async () => undefined,
  } as unknown as OpenCodeRuntime;
}

function mapEvents(events: readonly ReturnType<typeof event>[]) {
  const state = createPromptStreamState();
  const openCodeRuntime = runtime();

  return events.flatMap((item) =>
    Array.from(mapOpenCodeEvent({ runtime: openCodeRuntime, event: item as never, ref, state })),
  );
}

describe("OpenCode event mapper", () => {
  test("ignores events for other sessions", () => {
    expect(mapEvents([sessionIdle("other-session")])).toEqual([]);
  });

  test("keeps content order as started, delta, completed", () => {
    expect(mapEvents(nextTextSequence("session-1", "hello"))).toEqual([
      expect.objectContaining({ type: "content", phase: "started" }),
      expect.objectContaining({ type: "content", phase: "delta", delta: "hello" }),
      expect.objectContaining({ type: "content", phase: "completed", text: "hello" }),
    ]);
  });

  test("ignores legacy user message parts", () => {
    const mapped = mapEvents([
      event("message.updated", {
        sessionID: "session-1",
        info: { id: "user-1", sessionID: "session-1", role: "user", time: { created: 1 } },
      }),
      event("message.part.updated", {
        sessionID: "session-1",
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "user-1",
          type: "text",
          text: "hidden user input",
          time: { start: 1, end: 1 },
        },
      }),
    ]);

    expect(mapped).toEqual([]);
  });

  test("maps legacy assistant message and text part events", () => {
    const mapped = mapEvents([
      event("message.updated", {
        sessionID: "session-1",
        info: {
          id: "assistant-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1 },
          providerID: "provider-1",
          modelID: "model-1",
          agent: "build",
        },
      }),
      event("message.part.updated", {
        sessionID: "session-1",
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "assistant-1",
          type: "text",
          text: "hello",
          time: { start: 1, end: 2 },
        },
      }),
      event("message.updated", {
        sessionID: "session-1",
        info: {
          id: "assistant-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1, completed: 3 },
          providerID: "provider-1",
          modelID: "model-1",
          agent: "build",
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01,
          finish: "stop",
        },
      }),
      sessionIdle("session-1"),
    ]);

    expect(mapped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", phase: "started", role: "assistant" }),
        expect.objectContaining({ type: "turn", phase: "started", agent: "build" }),
        expect.objectContaining({ type: "content", phase: "delta", delta: "hello" }),
        expect.objectContaining({ type: "content", phase: "completed", text: "hello" }),
        expect.objectContaining({ type: "turn", phase: "completed", cost: 0.01 }),
        expect.objectContaining({ type: "run", phase: "completed", reason: "stop" }),
      ]),
    );
  });

  test("emits only one terminal run event for duplicate idle events", () => {
    expect(mapEvents([sessionIdle("session-1"), sessionIdle("session-1")])).toEqual([
      expect.objectContaining({ type: "run", phase: "completed" }),
    ]);
  });
});
