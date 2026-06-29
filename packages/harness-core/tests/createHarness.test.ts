import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterCreateSessionError,
  HarnessAdapterOpenError,
  HarnessCloseError,
  InvalidWorkingDirectoryError,
  createHarness,
  defineHarnessAdapter,
  harnessLogEvents,
  type HarnessLogger,
} from "../src";
import {
  createDeferred,
  createMockLogger,
  createTestAdapter,
  createThrowingLogger,
  type PiAdapterInput,
  type PiAdapterSession,
} from "./test-utils";

describe("createHarness", () => {
  test("reports configured lazy adapter status without opening adapters", () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "unused", adapterData: { sessionFile: "unused" } }),
        }),
      },
    });

    expect(harness.status()).toEqual({
      adapters: [{ id: "pi", state: "configured_lazy" }],
    });
    expect(handles.opens).toEqual([]);
  });

  test("reports opened adapter status after first operation", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async (input) =>
            Result.ok({
              sessionId: "pi-session-1",
              adapterData: { sessionFile: `${input.cwd}/session.jsonl` },
            }),
        }),
      },
    });

    expect(
      (
        await harness.createSession({
          harnessId: "pi",
          cwd: process.cwd(),
          adapterOptions: { sessionMode: "memory" },
        })
      ).isOk(),
    ).toBe(true);

    expect(harness.status()).toEqual({
      adapters: [{ id: "pi", state: "opened" }],
    });
    expect(handles.opens).toEqual(["pi"]);
  });

  test("reports closed adapter status after close", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          handles,
          createSession: async () => Result.ok({ sessionId: "pi-session-1", adapterData: {} }),
        }),
      },
    });

    expect((await harness.createSession({ harnessId: "pi", cwd: process.cwd() })).isOk()).toBe(
      true,
    );
    expect((await harness.close()).isOk()).toBe(true);

    expect(harness.status()).toEqual({
      adapters: [{ id: "pi", state: "closed" }],
    });
  });

  test("reports failed adapter open status with a safe reason", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          openThrow: new Error("secret-token-should-not-leak"),
          createSession: async () =>
            Result.ok({ sessionId: "unused", adapterData: { sessionFile: "unused" } }),
        }),
      },
    });

    expect(
      (
        await harness.createSession({
          harnessId: "pi",
          cwd: process.cwd(),
          adapterOptions: { sessionMode: "memory" },
        })
      ).isErr(),
    ).toBe(true);

    expect(harness.status()).toEqual({
      adapters: [{ id: "pi", state: "failed", reason: "HarnessAdapterOpenError" }],
    });
    expect(JSON.stringify(harness.status())).not.toContain("secret-token-should-not-leak");
  });

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
    const logger = createThrowingLogger();
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
    const canOpen = createDeferred();

    const harness = createHarness({
      adapters: {
        pi: defineHarnessAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          async open() {
            opens += 1;
            await canOpen.promise;

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

    canOpen.resolve();
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
    const canOpen = createDeferred();

    const harness = createHarness({
      adapters: {
        pi: defineHarnessAdapter<"pi", Record<never, never>, Record<never, never>>({
          id: "pi",
          async open() {
            opens += 1;
            await canOpen.promise;

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

    canOpen.resolve();
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

  test("surfaces adapter session creation returned failures", async () => {
    const cause = new Error("provider unavailable");
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () => Result.err(cause),
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
      expect(created.error.cause).toBe(cause);
    }
  });

  test("surfaces adapter session creation thrown failures", async () => {
    const cause = new Error("provider exploded");
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () => {
            throw cause;
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
      expect(created.error.cause).toBe(cause);
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

  test("wraps adapter open throws inside harness-core", async () => {
    const cause = new Error("sdk boot threw");
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          openThrow: cause,
          createSession: async () =>
            Result.ok({ sessionId: "unused", adapterData: { sessionFile: "unused" } }),
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
      expect(created.error.cause).toBe(cause);
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

  test("close does not open never-used adapters and is idempotent after success", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
        unused: createTestAdapter<"unused", Record<never, never>, Record<never, never>>({
          id: "unused",
          handles,
          createSession: async () => Result.ok({ sessionId: "unused-1", adapterData: {} }),
        }),
      },
    });

    await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "memory" },
    });

    const first = await harness.close();
    const second = await harness.close();

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(handles.opens).toEqual(["pi"]);
    expect(handles.closes).toEqual(["pi"]);
  });

  test("aggregates adapter close failures", async () => {
    const piCloseCause = new Error("pi close failed");
    const opencodeCloseCause = new Error("opencode close failed");
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          closeThrow: piCloseCause,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
        opencode: createTestAdapter<"opencode", Record<never, never>, Record<never, never>>({
          id: "opencode",
          handles,
          closeThrow: opencodeCloseCause,
          createSession: async () => Result.ok({ sessionId: "oc-1", adapterData: {} }),
        }),
      },
    });

    await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "persistent" },
    });
    await harness.createSession({ harnessId: "opencode", cwd: process.cwd() });

    const closed = await harness.close();

    expect(closed.isErr()).toBe(true);
    if (closed.isErr()) {
      expect(closed.error).toBeInstanceOf(HarnessCloseError);
      expect(closed.error.failures).toEqual([
        { harnessId: "pi", cause: piCloseCause },
        { harnessId: "opencode", cause: opencodeCloseCause },
      ]);
    }
    expect(handles.closes.sort()).toEqual(["opencode", "pi"]);
  });
});
