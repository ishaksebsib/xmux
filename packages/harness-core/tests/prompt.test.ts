import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterPromptError,
  InvalidWorkingDirectoryError,
  PromptStreamEndedWithoutTerminalEventError,
  createHarness,
  type HarnessPromptEvent,
  type SessionRef,
} from "../src";
import {
  collectAsync,
  createTestAdapter,
  type PiAdapterInput,
  type PiAdapterSession,
} from "./test-utils";

function createPromptHarness(args: {
  readonly events: (input: {
    readonly ref: SessionRef<"pi">;
    readonly signal?: AbortSignal;
  }) => AsyncIterable<HarnessPromptEvent<"pi">>;
}) {
  const handles = { opens: [], closes: [] };
  const harness = createHarness({
    adapters: {
      pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
        id: "pi",
        handles,
        createSession: async () =>
          Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
        operations: {
          prompt: async (input) => Result.ok(args.events(input)),
        },
      }),
    },
  });

  return { handles, harness };
}

async function promptEvents(args: {
  readonly harness: ReturnType<typeof createPromptHarness>["harness"];
  readonly signal?: AbortSignal;
}) {
  const prompted = await args.harness.prompt({
    ref: { harnessId: "pi", sessionId: "native-1" },
    cwd: process.cwd(),
    content: { type: "text", text: "hello" },
    adapterOptions: { sessionMode: "memory" },
    signal: args.signal,
  });

  expect(prompted.isOk()).toBe(true);
  return prompted.unwrap("prompt stream");
}

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
                  yield {
                    type: "run",
                    phase: "completed",
                    ref: input.ref,
                    reason: "stop",
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
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "content", phase: "delta", delta: "hello" });
    expect(events[2]).toMatchObject({ type: "run", phase: "completed", reason: "stop" });
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

  test("synthesizes run started when the adapter stream starts with another event", async () => {
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "content", phase: "delta", kind: "text", ref, delta: "hello" } as const;
          yield { type: "run", phase: "completed", ref, reason: "stop" } as const;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "content", phase: "delta", delta: "hello" });
    expect(events[2]).toMatchObject({ type: "run", phase: "completed" });
  });

  test("converts prompt stream failures after start to terminal failed run events", async () => {
    const cause = new Error("stream exploded");
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          throw cause;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "failed", reason: "error" });
    expect((events[1] as { error?: unknown }).error).toBe(cause);
  });

  test("converts prompt stream failures before start to synthetic start then failed", async () => {
    const cause = new Error("stream exploded before start");
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* (): AsyncIterable<HarnessPromptEvent<"pi">> {
          if (Date.now() < 0) yield { type: "run", phase: "started", ref };
          throw cause;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "failed", reason: "error" });
    expect((events[1] as { error?: unknown }).error).toBe(cause);
  });

  test("emits failed when the adapter stream ends without a terminal run event", async () => {
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          yield { type: "content", phase: "delta", kind: "text", ref, delta: "hello" } as const;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "content", phase: "delta", delta: "hello" });
    expect(events[2]).toMatchObject({ type: "run", phase: "failed", reason: "error" });
    expect((events[2] as { error?: unknown }).error).toBeInstanceOf(
      PromptStreamEndedWithoutTerminalEventError,
    );
  });

  test("does not emit an extra terminal event after completed", async () => {
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          yield { type: "run", phase: "completed", ref, reason: "stop" } as const;
          yield {
            type: "run",
            phase: "failed",
            ref,
            reason: "error",
            error: new Error("late"),
          } as const;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "completed" });
  });

  test("does not emit an extra terminal event after failed", async () => {
    const failure = new Error("failed");
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          yield { type: "run", phase: "failed", ref, reason: "error", error: failure } as const;
          yield { type: "run", phase: "completed", ref, reason: "stop" } as const;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "failed", reason: "error" });
    expect((events[1] as { error?: unknown }).error).toBe(failure);
  });

  test("emits synthetic started and aborted when the input signal is already aborted", async () => {
    const controller = new AbortController();
    const cause = new Error("already aborted");
    controller.abort(cause);
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          yield { type: "run", phase: "completed", ref, reason: "stop" } as const;
        })(),
    });

    const events = await collectAsync(await promptEvents({ harness, signal: controller.signal }));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "run", phase: "started" });
    expect(events[1]).toMatchObject({ type: "run", phase: "aborted", reason: "aborted" });
    expect((events[1] as { error?: unknown }).error).toBe(cause);
  });

  test("emits aborted when the input signal aborts while iterating", async () => {
    const controller = new AbortController();
    const cause = new Error("abort while running");
    const { harness } = createPromptHarness({
      events: ({ ref }) =>
        (async function* () {
          yield { type: "run", phase: "started", ref } as const;
          await new Promise<never>(() => {});
        })(),
    });

    const stream = await promptEvents({ harness, signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "run", phase: "started" });

    const second = iterator.next();
    controller.abort(cause);
    const aborted = await second;
    expect(aborted.value).toMatchObject({ type: "run", phase: "aborted", reason: "aborted" });
    expect((aborted.value as { error?: unknown }).error).toBe(cause);

    const done = await iterator.next();
    expect(done.done).toBe(true);
  });
});
