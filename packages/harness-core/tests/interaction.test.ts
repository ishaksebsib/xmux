import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterInteractionUnsupportedError,
  HarnessAdapterRespondInteractionError,
  InvalidWorkingDirectoryError,
  UnknownHarnessError,
  createHarness,
  type HarnessAdapterRespondInteractionInput,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

describe("interaction responses", () => {
  test("dispatches respondInteraction to the selected adapter", async () => {
    const handles = { opens: [], closes: [] };
    const calls: HarnessAdapterRespondInteractionInput<"pi", PiAdapterInput>[] = [];
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async (input) => {
              calls.push(input);
              return Result.ok();
            },
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "persistent" },
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      ref: { harnessId: "pi", sessionId: "native-1" },
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "persistent" },
    });
    expect(handles.opens).toEqual(["pi"]);
  });

  test("returns UnknownHarnessError for unknown harnesses", async () => {
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "missing", sessionId: "native-1" },
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "memory" },
    } as never);

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) expect(responded.error).toBeInstanceOf(UnknownHarnessError);
  });

  test("rejects an invalid cwd before opening the adapter", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async () => Result.ok(),
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: "/definitely/not/a/real/xmux/interaction/path",
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) expect(responded.error).toBeInstanceOf(InvalidWorkingDirectoryError);
    expect(handles.opens).toEqual([]);
  });

  test("invalid cwd takes precedence over an unknown harness id", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async () => Result.ok(),
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "missing", sessionId: "native-1" },
      cwd: "/definitely/not/a/real/xmux/interaction/unknown/path",
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "memory" },
    } as never);

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) expect(responded.error).toBeInstanceOf(InvalidWorkingDirectoryError);
    expect(handles.opens).toEqual([]);
  });

  test("returns unsupported error when adapter does not implement respondInteraction", async () => {
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      response: { kind: "permission", requestId: "request-1", decision: "allow_once" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) {
      expect(responded.error).toBeInstanceOf(HarnessAdapterInteractionUnsupportedError);
    }
  });

  test("wraps adapter returned errors", async () => {
    const cause = new Error("adapter rejected");
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async () => Result.err(cause),
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      response: { kind: "permission", requestId: "request-1", decision: "reject" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) {
      expect(responded.error).toBeInstanceOf(HarnessAdapterRespondInteractionError);
      expect(responded.error.cause).toBe(cause);
    }
  });

  test("wraps adapter thrown errors", async () => {
    const cause = new Error("adapter exploded");
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async () => {
              throw cause;
            },
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      response: { kind: "question", requestId: "question-1", reject: true },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) {
      expect(responded.error).toBeInstanceOf(HarnessAdapterRespondInteractionError);
      expect(responded.error.cause).toBe(cause);
    }
  });

  test("passes cwd, adapter options, and signal", async () => {
    const controller = new AbortController();
    let received: HarnessAdapterRespondInteractionInput<"pi", PiAdapterInput> | undefined;
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            respondInteraction: async (input) => {
              received = input;
              return Result.ok();
            },
          },
        }),
      },
    });

    const responded = await harness.respondInteraction({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: process.cwd(),
      response: { kind: "question", requestId: "question-1", answers: [["yes"]] },
      adapterOptions: { sessionMode: "persistent" },
      signal: controller.signal,
    });

    expect(responded.isOk()).toBe(true);
    expect(received?.cwd).toBe(process.cwd());
    expect(received?.adapterOptions).toEqual({ sessionMode: "persistent" });
    expect(received?.signal).toBe(controller.signal);
  });
});
