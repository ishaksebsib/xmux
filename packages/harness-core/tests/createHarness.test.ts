import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import {
  HarnessAdapterCreateSessionError,
  HarnessAdapterOpenError,
  InvalidWorkingDirectoryError,
  createHarness,
  defineHarnessAdapter,
  harnessLogEvents,
  type HarnessLogger,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

function createMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies HarnessLogger;
}

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

  test("passes loggers to adapters and logs safe structured metadata", async () => {
    const handles = { opens: [], closes: [] };
    const logger = createMockLogger();
    let openLogger: HarnessLogger | undefined;
    const harness = createHarness({
      logger,
      now: () => new Date("2026-05-05T10:00:00.000Z"),
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          onOpenContext: (context) => {
            openLogger = context.logger;
          },
          createSession: async (input) => {
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
      title: "do not log this",
      adapterOptions: { sessionMode: "persistent" },
    });

    expect(created.isOk()).toBe(true);
    expect(openLogger).toBe(logger);
    expect(logger.debug).toHaveBeenCalledWith(
      harnessLogEvents.operationBegin,
      expect.objectContaining({
        component: "@xmux/harness-core",
        packageName: "@xmux/harness-core",
        harnessId: "pi",
        operation: "createSession",
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      harnessLogEvents.operationSuccess,
      expect.objectContaining({
        harnessId: "pi",
        operation: "createSession",
        result: "ok",
        durationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("do not log this");
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(process.cwd());
  });

  test("logger failures do not affect harness operations", async () => {
    const logger = {
      trace: vi.fn(() => {
        throw new Error("logger failed");
      }),
      debug: vi.fn(() => {
        throw new Error("logger failed");
      }),
      info: vi.fn(() => {
        throw new Error("logger failed");
      }),
      warn: vi.fn(() => {
        throw new Error("logger failed");
      }),
      error: vi.fn(() => {
        throw new Error("logger failed");
      }),
    } satisfies HarnessLogger;
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      logger,
      adapters: {
        pi: createTestAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          handles,
          createSession: async () => Result.ok({ sessionId: "pi-session-1", adapterData: {} }),
        }),
      },
    });

    const created = await harness.createSession({ harnessId: "pi", cwd: process.cwd() });
    const closed = await harness.close();

    expect(created.isOk()).toBe(true);
    expect(closed.isOk()).toBe(true);
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

  test("deduplicates concurrent first runtime opens", async () => {
    let opens = 0;
    let closes = 0;
    let releaseOpen!: () => void;
    const canOpen = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });

    const harness = createHarness({
      adapters: {
        pi: defineHarnessAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          async open() {
            opens += 1;
            await canOpen;

            return Result.ok({
              id: "pi" as const,
              async createSession() {
                return Result.ok({ sessionId: "pi-1", adapterData: {} });
              },
              async resumeSession(input) {
                return Result.ok({ sessionId: input.sessionId, adapterData: {} });
              },
              async listSessions() {
                return Result.ok([]);
              },
              async getSession(input) {
                return Result.ok({ sessionId: input.ref.sessionId, adapterData: {} });
              },
              async prompt(input) {
                return Result.ok(
                  (async function* () {
                    yield { type: "run", phase: "started", ref: input.ref } as const;
                    yield {
                      type: "run",
                      phase: "completed",
                      ref: input.ref,
                      reason: "stop",
                    } as const;
                  })(),
                );
              },
              async deleteSession() {
                return Result.ok();
              },
              async abort() {
                return Result.ok();
              },
              async close() {
                closes += 1;
              },
            });
          },
        }),
      },
    });

    const listed = harness.listSessions({ harnessId: "pi" });
    const got = harness.getSession({ ref: { harnessId: "pi", sessionId: "session-1" } });

    await Promise.resolve();
    expect(opens).toBe(1);

    releaseOpen();
    const [listedResult, gotResult] = await Promise.all([listed, got]);

    expect(listedResult.isOk()).toBe(true);
    expect(gotResult.isOk()).toBe(true);
    expect(opens).toBe(1);

    await harness.close();
    expect(closes).toBe(1);
  });

  test("close waits for in-flight runtime opens", async () => {
    let opens = 0;
    let closes = 0;
    let releaseOpen!: () => void;
    const canOpen = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });

    const harness = createHarness({
      adapters: {
        pi: defineHarnessAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          async open() {
            opens += 1;
            await canOpen;

            return Result.ok({
              id: "pi" as const,
              async createSession() {
                return Result.ok({ sessionId: "pi-1", adapterData: {} });
              },
              async resumeSession(input) {
                return Result.ok({ sessionId: input.sessionId, adapterData: {} });
              },
              async listSessions() {
                return Result.ok([]);
              },
              async getSession(input) {
                return Result.ok({ sessionId: input.ref.sessionId, adapterData: {} });
              },
              async prompt(input) {
                return Result.ok(
                  (async function* () {
                    yield { type: "run", phase: "started", ref: input.ref } as const;
                    yield {
                      type: "run",
                      phase: "completed",
                      ref: input.ref,
                      reason: "stop",
                    } as const;
                  })(),
                );
              },
              async deleteSession() {
                return Result.ok();
              },
              async abort() {
                return Result.ok();
              },
              async close() {
                closes += 1;
              },
            });
          },
        }),
      },
    });

    const listed = harness.listSessions({ harnessId: "pi" });
    await Promise.resolve();
    expect(opens).toBe(1);

    const closed = harness.close();
    await Promise.resolve();
    expect(closes).toBe(0);

    releaseOpen();
    const [listedResult, closedResult] = await Promise.all([listed, closed]);

    expect(listedResult.isOk()).toBe(true);
    expect(closedResult.isOk()).toBe(true);
    expect(closes).toBe(1);
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
