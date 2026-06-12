import { describe, expect, test } from "vitest";
import {
  getEventSessionId,
  normalizeOpenCodeStreamEvent,
  parseToolInput,
  toRunReason,
  toToolOutputContent,
  toUsage,
} from "../../src/prompt/event-utils";

describe("OpenCode event utilities", () => {
  test("normalizes raw, wrapped, sync, and malformed stream events safely", () => {
    expect(normalizeOpenCodeStreamEvent({ type: "session.idle", properties: { sessionID: "s1" } })).toMatchObject({
      type: "session.idle",
      properties: { sessionID: "s1" },
    });
    expect(
      normalizeOpenCodeStreamEvent({ payload: { type: "session.idle", properties: { sessionID: "s1" } } }),
    ).toMatchObject({ type: "session.idle" });
    expect(
      normalizeOpenCodeStreamEvent({
        type: "sync",
        syncEvent: { id: "evt-1", type: "message.updated.1", data: { sessionID: "s1" } },
      }),
    ).toEqual({ id: "evt-1", type: "message.updated", properties: { sessionID: "s1" } });
    expect(normalizeOpenCodeStreamEvent({ payload: { nope: true } })).toBeUndefined();
  });

  test("extracts session ids from current and legacy event shapes", () => {
    expect(getEventSessionId({ type: "session.idle", properties: { sessionID: "s1" } } as never)).toBe("s1");
    expect(
      getEventSessionId({ type: "message.updated", properties: { info: { sessionID: "s2" } } } as never),
    ).toBe("s2");
  });

  test("maps usage, run reasons, tool input, and tool output", () => {
    expect(toUsage({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 }, total: 6 })).toEqual({
      input: 1,
      output: 2,
      reasoning: 3,
      cacheRead: 4,
      cacheWrite: 5,
      total: 6,
    });
    expect(toRunReason("length")).toBe("length");
    expect(toRunReason("tool_use")).toBe("tool_use");
    expect(toRunReason("stop")).toBe("stop");
    expect(parseToolInput('{"ok":true}')).toEqual({ ok: true });
    expect(parseToolInput("not-json")).toBe("not-json");
    expect(
      toToolOutputContent([{ type: "text", text: "done" }], { ok: true }),
    ).toEqual([{ type: "text", text: "done" }, { type: "json", value: { ok: true } }]);
  });
});
