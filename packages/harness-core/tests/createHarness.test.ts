import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterCreateSessionError,
  HarnessAdapterOpenError,
  InvalidWorkingDirectoryError,
  createHarness,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

describe("createHarness", () => {
  test("creates a session with the selected adapter", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      now: () => new Date("2026-05-05T10:00:00.000Z"),
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async (input) => {
            expect(input.adapterOptions.sessionMode).toBe("persistent");
            expect(input.title).toBe("ship it");

            return Result.ok({
              sessionId: "pi-session-1",
              adapterData: { sessionFile: `${input.cwd}/.pi/session.jsonl` },
            });
          },
        }),
      },
    });

    const created = await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      title: "ship it",
      adapterOptions: { sessionMode: "persistent" },
    });

    expect(created.isOk()).toBe(true);
    const session = created.unwrap("expected session to be created");
    expect(session.ref).toEqual({ harnessId: "pi", sessionId: "pi-session-1" });
    expect(session.createdAt).toBe("2026-05-05T10:00:00.000Z");
    expect(session.adapterData.sessionFile).toContain(".pi/session.jsonl");
    expect(handles.opens).toEqual(["pi"]);
  });

  test("reuses an opened adapter runtime across session creations", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        opencode: createTestAdapter<"opencode", Record<never, never>, Record<never, never>>({
          id: "opencode",
          handles,
          createSession: async () => {
            return Result.ok({ sessionId: crypto.randomUUID(), adapterData: {} });
          },
        }),
      },
    });

    const first = await harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
    });
    const second = await harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
    });

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(handles.opens).toEqual(["opencode"]);
  });

  test("rejects invalid working directories before opening an adapter", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        opencode: createTestAdapter<"opencode", Record<never, never>, Record<never, never>>({
          id: "opencode",
          handles,
          createSession: async () => Result.ok({ sessionId: "unused", adapterData: {} }),
        }),
      },
    });

    const created = await harness.createSession({
      harnessId: "opencode",
      cwd: "/definitely/not/a/real/xmux/path",
    });

    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error).toBeInstanceOf(InvalidWorkingDirectoryError);
    }
    expect(handles.opens).toEqual([]);
  });

  test("surfaces adapter session creation failures", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () => {
            return Result.err(new Error("provider unavailable"));
          },
        }),
      },
    });

    const created = await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "memory" },
    });

    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
    }
  });

  test("wraps adapter open failures inside harness-core", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          openError: new Error("sdk boot failed"),
          createSession: async () => {
            return Result.ok({
              sessionId: "unused",
              adapterData: { sessionFile: "unused" },
            });
          },
        }),
      },
    });

    const created = await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "memory" },
    });

    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error).toBeInstanceOf(HarnessAdapterOpenError);
    }
    expect(handles.opens).toEqual(["pi"]);
  });

  test("closes every opened runtime", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
        opencode: createTestAdapter<"opencode", Record<never, never>, Record<never, never>>({
          id: "opencode",
          handles,
          createSession: async () => Result.ok({ sessionId: "oc-1", adapterData: {} }),
        }),
      },
    });

    await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "persistent" },
    });
    await harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
    });

    const closed = await harness.close();

    expect(closed.isOk()).toBe(true);
    expect(handles.closes.sort()).toEqual(["opencode", "pi"]);
  });
});
