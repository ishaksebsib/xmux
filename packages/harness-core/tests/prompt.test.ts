import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { HarnessAdapterPromptError, InvalidWorkingDirectoryError, createHarness } from "../src";
import {
  collectAsync,
  createTestAdapter,
  type PiAdapterInput,
  type PiAdapterSession,
} from "./test-utils";

describe("prompt", () => {
  test("prompts through the selected adapter", async () => {
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
            prompt: async (input) => {
              calls.push(
                `prompt:${input.ref.sessionId}:${input.cwd}:${input.adapterOptions.sessionMode}:${input.content.length}`,
              );
              return Result.ok(
                (async function* () {
                  yield { type: "run", phase: "started", ref: input.ref } as const;
                  yield {
                    type: "content",
                    phase: "delta",
                    kind: "text",
                    ref: input.ref,
                    delta: "hello",
                  } as const;
                })(),
              );
            },
          },
        }),
      },
    });

    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "hello" },
      adapterOptions: { sessionMode: "persistent" },
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "content", phase: "delta", delta: "hello" });
    expect(calls).toEqual([`prompt:native-1:${process.cwd()}:persistent:1`]);
    expect(handles.opens).toEqual(["pi"]);
  });

  test("wraps prompt setup failures", async () => {
    const returnedHandles = { opens: [], closes: [] };
    const returnedHarness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: returnedHandles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            prompt: async () => Result.err(new Error("prompt failed")),
          },
        }),
      },
    });
    const thrownHandles = { opens: [], closes: [] };
    const thrownHarness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles: thrownHandles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            prompt: async () => {
              throw new Error("prompt exploded");
            },
          },
        }),
      },
    });

    const returned = await returnedHarness.prompt({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "hello" },
      adapterOptions: { sessionMode: "memory" },
    });
    const thrown = await thrownHarness.prompt({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "hello" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(returned.isErr()).toBe(true);
    expect(thrown.isErr()).toBe(true);
    if (returned.isErr()) expect(returned.error).toBeInstanceOf(HarnessAdapterPromptError);
    if (thrown.isErr()) expect(thrown.error).toBeInstanceOf(HarnessAdapterPromptError);
  });

  test("rejects an invalid prompt cwd before opening the adapter", async () => {
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

    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: `/tmp/xmux-missing-prompt-cwd-${process.pid}`,
      content: { type: "text", text: "hello" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(prompted.isErr()).toBe(true);
    if (prompted.isErr()) expect(prompted.error).toBeInstanceOf(InvalidWorkingDirectoryError);
    expect(handles.opens).toEqual([]);
  });

  test("converts prompt stream failures to terminal failed run events", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            prompt: async (input) =>
              Result.ok(
                (async function* () {
                  yield { type: "run", phase: "started", ref: input.ref } as const;
                  throw new Error("stream exploded");
                })(),
              ),
          },
        }),
      },
    });

    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "native-1" },
      cwd: process.cwd(),
      content: [{ type: "text", text: "hello" }],
      adapterOptions: { sessionMode: "memory" },
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "failed", reason: "error" });
    expect((events[1] as { error?: unknown }).error).toBeInstanceOf(Error);
  });
});
