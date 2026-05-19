import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterAbortError,
  HarnessAdapterCreateSessionError,
  HarnessAdapterDeleteSessionError,
  HarnessAdapterGetSessionError,
  HarnessAdapterListSessionsError,
  HarnessAdapterOpenError,
  HarnessAdapterPromptError,
  HarnessAdapterResumeSessionError,
  InvalidWorkingDirectoryError,
  UnknownHarnessError,
  createHarness,
  defineHarnessAdapter,
  type HarnessAdapterDefinition,
  type OpenedHarnessAdapter,
} from "../src";

type PiAdapterInput = {
  readonly sessionMode: "memory" | "persistent";
};

type PiAdapterSession = {
  readonly sessionFile: string;
};

type OpenedAdapterHandles = {
  readonly opens: string[];
  readonly closes: string[];
};

function createTestAdapter<
  THarnessId extends string,
  TAdapterOptions extends Record<string, unknown>,
  TAdapterSession extends Record<string, unknown>,
>(args: {
  readonly id: THarnessId;
  readonly handles: OpenedAdapterHandles;
  readonly openError?: unknown;
  readonly createSession: OpenedHarnessAdapter<
    THarnessId,
    TAdapterOptions,
    TAdapterSession
  >["createSession"];
}): HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession> {
  return defineHarnessAdapter({
    id: args.id,
    async open() {
      args.handles.opens.push(args.id);

      if (args.openError !== undefined) {
        return Result.err(args.openError);
      }

      return Result.ok({
        id: args.id,
        createSession: args.createSession,
        resumeSession: async () => Result.err(new Error("not implemented in test adapter")),
        listSessions: async () => Result.err(new Error("not implemented in test adapter")),
        getSession: async () => Result.err(new Error("not implemented in test adapter")),
        prompt: async () => Result.err(new Error("not implemented in test adapter")),
        deleteSession: async () => Result.err(new Error("not implemented in test adapter")),
        abort: async () => Result.err(new Error("not implemented in test adapter")),
        close: async () => {
          args.handles.closes.push(args.id);
        },
      });
    },
  });
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

  test("session-control stubs check unknown harness before method errors", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
      },
    });

    const resumed = await harness.resumeSession({
      // @ts-expect-error runtime test intentionally targets an unknown harness
      harnessId: "missing",
      sessionId: "session-1",
      adapterOptions: { sessionMode: "memory" },
    });
    const listed = await harness.listSessions({
      // @ts-expect-error runtime test intentionally targets an unknown harness
      harnessId: "missing",
      adapterOptions: { sessionMode: "memory" },
    });

    expect(resumed.isErr()).toBe(true);
    expect(listed.isErr()).toBe(true);
    if (resumed.isErr()) {
      expect(resumed.error).toBeInstanceOf(UnknownHarnessError);
    }
    if (listed.isErr()) {
      expect(listed.error).toBeInstanceOf(UnknownHarnessError);
    }
  });

  test("session-control stubs return method errors for harness-id operations", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
      },
    });

    const resumed = await harness.resumeSession({
      harnessId: "pi",
      sessionId: "session-1",
      adapterOptions: { sessionMode: "memory" },
    });
    const listed = await harness.listSessions({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });

    expect(resumed.isErr()).toBe(true);
    expect(listed.isErr()).toBe(true);
    if (resumed.isErr()) {
      expect(resumed.error).toBeInstanceOf(HarnessAdapterResumeSessionError);
    }
    if (listed.isErr()) {
      expect(listed.error).toBeInstanceOf(HarnessAdapterListSessionsError);
    }
    expect(handles.opens).toEqual(["pi"]);
  });

  test("ref-based session-control stubs pass refs without requiring core session state", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "a" } }),
        }),
      },
    });

    const ref = { harnessId: "pi" as const, sessionId: "session-1" };
    const get = await harness.getSession({
      ref,
      adapterOptions: { sessionMode: "memory" },
    });
    const prompted = await harness.prompt({
      ref,
      content: { type: "text", text: "hello" },
      adapterOptions: { sessionMode: "memory" },
    });
    const deleted = await harness.deleteSession({
      ref,
      adapterOptions: { sessionMode: "memory" },
    });
    const aborted = await harness.abort({
      ref,
      adapterOptions: { sessionMode: "memory" },
    });

    expect(get.isErr()).toBe(true);
    expect(prompted.isErr()).toBe(true);
    expect(deleted.isErr()).toBe(true);
    expect(aborted.isErr()).toBe(true);
    if (get.isErr()) {
      expect(get.error).toBeInstanceOf(HarnessAdapterGetSessionError);
    }
    if (prompted.isErr()) {
      expect(prompted.error).toBeInstanceOf(HarnessAdapterPromptError);
    }
    if (deleted.isErr()) {
      expect(deleted.error).toBeInstanceOf(HarnessAdapterDeleteSessionError);
    }
    if (aborted.isErr()) {
      expect(aborted.error).toBeInstanceOf(HarnessAdapterAbortError);
    }
    expect(handles.opens).toEqual(["pi"]);
  });
});
