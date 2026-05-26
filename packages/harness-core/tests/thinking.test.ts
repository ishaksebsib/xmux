import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterGetThinkingError,
  HarnessAdapterSetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
  createHarness,
  type HarnessThinkingLevel,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

describe("thinking management", () => {
  test("gets and sets harness and session selected thinking levels", async () => {
    const handles = { opens: [], closes: [] };
    const selected = new Map<string, HarnessThinkingLevel>();
    const supportedLevels = ["off", "low", "medium", "high", "xhigh"] as const;
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            getThinking: async (input) => {
              expect(input.adapterOptions.sessionMode).toBe("memory");
              const key = input.target.type === "harness" ? "harness" : input.target.ref.sessionId;
              return Result.ok({
                target: input.target,
                level: selected.get(key),
                supportedLevels,
                source: selected.has(key) ? input.target.type : "unset",
              });
            },
            setThinking: async (input) => {
              expect(input.adapterOptions.sessionMode).toBe("memory");
              const key = input.target.type === "harness" ? "harness" : input.target.ref.sessionId;
              if (input.update.type === "set") {
                selected.set(key, input.update.level);
              } else {
                selected.delete(key);
              }

              return Result.ok({
                target: input.target,
                level: selected.get(key),
                supportedLevels,
                source: selected.has(key) ? input.target.type : "unset",
              });
            },
          },
        }),
      },
    });

    const harnessSet = await harness.setThinking({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "set", level: "high" },
      adapterOptions: { sessionMode: "memory" },
    });
    const sessionSet = await harness.setThinking({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      update: { type: "set", level: "xhigh" },
      adapterOptions: { sessionMode: "memory" },
    });
    const sessionGot = await harness.getThinking({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(harnessSet.unwrap("harness thinking set").level).toBe("high");
    expect(sessionSet.unwrap("session thinking set").level).toBe("xhigh");
    expect(sessionGot.unwrap("session thinking get")).toEqual({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      level: "xhigh",
      supportedLevels,
      source: "session",
    });
    expect(handles.opens).toEqual(["pi"]);
  });

  test("threads explicit thinking through createSession and prompt", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async (input) => {
            expect(input.thinking).toBe("high");
            return Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } });
          },
          operations: {
            prompt: async (input) => {
              expect(input.thinking).toBe("xhigh");
              return Result.ok(
                (async function* () {
                  yield { type: "run", phase: "started", ref: input.ref } as const;
                })(),
              );
            },
          },
        }),
      },
    });

    const created = await harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      thinking: "high",
      adapterOptions: { sessionMode: "memory" },
    });
    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "pi-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "hello" },
      thinking: "xhigh",
      adapterOptions: { sessionMode: "memory" },
    });

    expect(created.isOk()).toBe(true);
    expect(prompted.isOk()).toBe(true);
  });

  test("returns unsupported errors when an adapter has no thinking methods", async () => {
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

    const got = await harness.getThinking({
      target: { type: "harness", harnessId: "pi" },
      adapterOptions: { sessionMode: "memory" },
    });
    const set = await harness.setThinking({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "clear" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(got.isErr()).toBe(true);
    expect(set.isErr()).toBe(true);
    if (got.isErr()) expect(got.error).toBeInstanceOf(HarnessAdapterThinkingUnsupportedError);
    if (set.isErr()) expect(set.error).toBeInstanceOf(HarnessAdapterThinkingUnsupportedError);
  });

  test("wraps thinking adapter failures", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            getThinking: async () => Result.err(new Error("get thinking failed")),
            setThinking: async () => Result.err(new Error("set thinking failed")),
          },
        }),
      },
    });

    const got = await harness.getThinking({
      target: { type: "harness", harnessId: "pi" },
      adapterOptions: { sessionMode: "memory" },
    });
    const set = await harness.setThinking({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "clear" },
      adapterOptions: { sessionMode: "memory" },
    });

    if (got.isErr()) expect(got.error).toBeInstanceOf(HarnessAdapterGetThinkingError);
    if (set.isErr()) expect(set.error).toBeInstanceOf(HarnessAdapterSetThinkingError);
    expect(got.isErr()).toBe(true);
    expect(set.isErr()).toBe(true);
  });
});
