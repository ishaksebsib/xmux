import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterAbortError,
  HarnessAdapterDeleteSessionError,
  HarnessAdapterGetSessionError,
  HarnessAdapterListSessionsError,
  HarnessAdapterPromptError,
  HarnessAdapterResumeSessionError,
  InvalidWorkingDirectoryError,
  UnknownHarnessError,
  createHarness,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

describe("session-control", () => {
  test("stubs check unknown harness before method errors", async () => {
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

  test("stubs return method errors for harness-id operations", async () => {
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

  test("implements non-prompt session-control operations with adapter dispatch", async () => {
    const handles = { opens: [], closes: [] };
    const calls: string[] = [];
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            resumeSession: async (input) => {
              calls.push(`resume:${input.sessionId}:${input.adapterOptions.sessionMode}`);
              return Result.ok({
                sessionId: input.sessionId,
                cwd: process.cwd(),
                title: "resumed",
                adapterData: { sessionFile: "resumed.jsonl" },
              });
            },
            listSessions: async (input) => {
              calls.push(`list:${input.adapterOptions.sessionMode}`);
              return Result.ok([
                {
                  sessionId: "listed-1",
                  cwd: process.cwd(),
                  title: "listed",
                  adapterData: { sessionFile: "listed.jsonl" },
                },
              ]);
            },
            getSession: async (input) => {
              calls.push(`get:${input.ref.sessionId}:${input.adapterOptions.sessionMode}`);
              return Result.ok({
                sessionId: input.ref.sessionId,
                cwd: process.cwd(),
                title: "got",
                adapterData: { sessionFile: "got.jsonl" },
              });
            },
            deleteSession: async (input) => {
              calls.push(`delete:${input.ref.sessionId}:${input.adapterOptions.sessionMode}`);
              return Result.ok();
            },
            abort: async (input) => {
              calls.push(`abort:${input.ref.sessionId}:${input.adapterOptions.sessionMode}`);
              return Result.ok();
            },
          },
        }),
      },
    });

    const resumed = await harness.resumeSession({
      harnessId: "pi",
      sessionId: "native-1",
      cwd: process.cwd(),
      adapterOptions: { sessionMode: "persistent" },
    });
    const listed = await harness.listSessions({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });
    const got = await harness.getSession({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "memory" },
    });
    const deleted = await harness.deleteSession({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "persistent" },
    });
    const aborted = await harness.abort({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(resumed.isOk()).toBe(true);
    expect(listed.isOk()).toBe(true);
    expect(got.isOk()).toBe(true);
    expect(deleted.isOk()).toBe(true);
    expect(aborted.isOk()).toBe(true);
    expect(resumed.unwrap("resume").ref).toEqual({ harnessId: "pi", sessionId: "native-1" });
    expect(listed.unwrap("list")[0]?.ref).toEqual({ harnessId: "pi", sessionId: "listed-1" });
    expect(got.unwrap("get").adapterData.sessionFile).toBe("got.jsonl");
    expect(calls).toEqual([
      "resume:native-1:persistent",
      "list:memory",
      "get:native-1:memory",
      "delete:native-1:persistent",
      "abort:native-1:memory",
    ]);
    expect(handles.opens).toEqual(["pi"]);
  });

  test("invalid resume cwd prevents adapter open", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
        }),
      },
    });

    const resumed = await harness.resumeSession({
      harnessId: "pi",
      sessionId: "native-1",
      cwd: "/definitely/not/a/real/xmux/resume/path",
      adapterOptions: { sessionMode: "memory" },
    });

    expect(resumed.isErr()).toBe(true);
    if (resumed.isErr()) {
      expect(resumed.error).toBeInstanceOf(InvalidWorkingDirectoryError);
    }
    expect(handles.opens).toEqual([]);
  });

  test("wraps adapter returned and thrown session-control failures", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            resumeSession: async () => Result.err(new Error("resume failed")),
            listSessions: async () => {
              throw new Error("list exploded");
            },
            getSession: async () => Result.err(new Error("get failed")),
            deleteSession: async () => {
              throw new Error("delete exploded");
            },
            abort: async () => Result.err(new Error("abort failed")),
          },
        }),
      },
    });

    const resumed = await harness.resumeSession({
      harnessId: "pi",
      sessionId: "native-1",
      adapterOptions: { sessionMode: "memory" },
    });
    const listed = await harness.listSessions({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });
    const got = await harness.getSession({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "memory" },
    });
    const deleted = await harness.deleteSession({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "memory" },
    });
    const aborted = await harness.abort({
      ref: { harnessId: "pi", sessionId: "native-1" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(resumed.isErr()).toBe(true);
    expect(listed.isErr()).toBe(true);
    expect(got.isErr()).toBe(true);
    expect(deleted.isErr()).toBe(true);
    expect(aborted.isErr()).toBe(true);
    if (resumed.isErr()) expect(resumed.error).toBeInstanceOf(HarnessAdapterResumeSessionError);
    if (listed.isErr()) expect(listed.error).toBeInstanceOf(HarnessAdapterListSessionsError);
    if (got.isErr()) expect(got.error).toBeInstanceOf(HarnessAdapterGetSessionError);
    if (deleted.isErr()) expect(deleted.error).toBeInstanceOf(HarnessAdapterDeleteSessionError);
    if (aborted.isErr()) expect(aborted.error).toBeInstanceOf(HarnessAdapterAbortError);
  });

  test("wraps invalid adapter-returned cwd", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            listSessions: async () =>
              Result.ok([
                {
                  sessionId: "bad-cwd",
                  cwd: "/definitely/not/a/real/xmux/adapter/path",
                  adapterData: { sessionFile: "bad.jsonl" },
                },
              ]),
          },
        }),
      },
    });

    const listed = await harness.listSessions({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });

    expect(listed.isErr()).toBe(true);
    if (listed.isErr()) {
      expect(listed.error).toBeInstanceOf(HarnessAdapterListSessionsError);
      expect(listed.error.cause).toBeInstanceOf(InvalidWorkingDirectoryError);
    }
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
