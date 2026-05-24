import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import {
  HarnessAdapterGetModelError,
  HarnessAdapterListModelsError,
  HarnessAdapterModelUnsupportedError,
  HarnessAdapterSetModelError,
  createHarness,
  type HarnessModelRef,
} from "../src";
import { createTestAdapter, type PiAdapterInput, type PiAdapterSession } from "./test-utils";

const sonnet = {
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
} satisfies HarnessModelRef;

const opusThinking = {
  providerId: "anthropic",
  modelId: "claude-opus-4-5",
  variant: "thinking",
} satisfies HarnessModelRef;

describe("model management", () => {
  test("lists models through the selected adapter", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<
          "pi",
          PiAdapterInput,
          PiAdapterSession,
          { readonly nativeProvider: string }
        >({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            listModels: async (input) => {
              expect(input.cwd).toBe(process.cwd());
              expect(input.includeUnavailable).toBe(true);
              expect(input.adapterOptions.sessionMode).toBe("persistent");

              return Result.ok([
                {
                  harnessId: "pi",
                  ref: sonnet,
                  name: "Claude Sonnet 4.5",
                  providerName: "Anthropic",
                  available: true,
                  capabilities: { tools: true, reasoning: true, input: ["text", "image"] },
                  limits: { context: 200_000, output: 64_000 },
                  adapterData: { nativeProvider: "anthropic" },
                },
              ]);
            },
          },
        }),
      },
    });

    const listed = await harness.listModels({
      harnessId: "pi",
      cwd: process.cwd(),
      includeUnavailable: true,
      adapterOptions: { sessionMode: "persistent" },
    });

    expect(listed.isOk()).toBe(true);
    const models = listed.unwrap("expected models");
    expect(models).toHaveLength(1);
    expect(models[0]?.ref).toEqual(sonnet);
    expect(models[0]?.adapterData.nativeProvider).toBe("anthropic");
    expect(handles.opens).toEqual(["pi"]);
  });

  test("gets and sets harness and session selected models", async () => {
    const handles = { opens: [], closes: [] };
    const selected = new Map<string, HarnessModelRef>();
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            getModel: async (input) => {
              expect(input.adapterOptions.sessionMode).toBe("memory");
              const key = input.target.type === "harness" ? "harness" : input.target.ref.sessionId;
              return Result.ok({
                target: input.target,
                model: selected.get(key),
                source: selected.has(key) ? input.target.type : "unset",
              });
            },
            setModel: async (input) => {
              expect(input.adapterOptions.sessionMode).toBe("memory");
              const key = input.target.type === "harness" ? "harness" : input.target.ref.sessionId;
              if (input.update.type === "set") {
                selected.set(key, input.update.model);
              } else {
                selected.delete(key);
              }

              return Result.ok({
                target: input.target,
                model: selected.get(key),
                source: selected.has(key) ? input.target.type : "unset",
              });
            },
          },
        }),
      },
    });

    const harnessSet = await harness.setModel({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "set", model: sonnet },
      adapterOptions: { sessionMode: "memory" },
    });
    const sessionSet = await harness.setModel({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      update: { type: "set", model: opusThinking },
      adapterOptions: { sessionMode: "memory" },
    });
    const sessionGot = await harness.getModel({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(harnessSet.unwrap("harness set").model).toEqual(sonnet);
    expect(sessionSet.unwrap("session set").model).toEqual(opusThinking);
    expect(sessionGot.unwrap("session get")).toEqual({
      target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
      model: opusThinking,
      source: "session",
    });
    expect(handles.opens).toEqual(["pi"]);
  });

  test("threads explicit models through createSession and prompt", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async (input) => {
            expect(input.model).toEqual(sonnet);
            return Result.ok({
              sessionId: "pi-1",
              model: opusThinking,
              adapterData: { sessionFile: "created" },
            });
          },
          operations: {
            prompt: async (input) => {
              expect(input.model).toEqual(opusThinking);
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
      model: sonnet,
      adapterOptions: { sessionMode: "memory" },
    });
    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "pi-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "hello" },
      model: opusThinking,
      adapterOptions: { sessionMode: "memory" },
    });

    expect(created.unwrap("created session").model).toEqual(opusThinking);
    expect(prompted.isOk()).toBe(true);
  });

  test("returns unsupported errors when an adapter has no model methods", async () => {
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

    const listed = await harness.listModels({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });
    const got = await harness.getModel({
      target: { type: "harness", harnessId: "pi" },
      adapterOptions: { sessionMode: "memory" },
    });
    const set = await harness.setModel({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "clear" },
      adapterOptions: { sessionMode: "memory" },
    });

    expect(listed.isErr()).toBe(true);
    expect(got.isErr()).toBe(true);
    expect(set.isErr()).toBe(true);
    if (listed.isErr()) expect(listed.error).toBeInstanceOf(HarnessAdapterModelUnsupportedError);
    if (got.isErr()) expect(got.error).toBeInstanceOf(HarnessAdapterModelUnsupportedError);
    if (set.isErr()) expect(set.error).toBeInstanceOf(HarnessAdapterModelUnsupportedError);
  });

  test("wraps model adapter failures", async () => {
    const handles = { opens: [], closes: [] };
    const harness = createHarness({
      adapters: {
        pi: createTestAdapter<"pi", PiAdapterInput, PiAdapterSession>({
          id: "pi",
          handles,
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            listModels: async () => Result.err(new Error("list failed")),
            getModel: async () => Result.err(new Error("get failed")),
            setModel: async () => Result.err(new Error("set failed")),
          },
        }),
      },
    });

    const listed = await harness.listModels({
      harnessId: "pi",
      adapterOptions: { sessionMode: "memory" },
    });
    const got = await harness.getModel({
      target: { type: "harness", harnessId: "pi" },
      adapterOptions: { sessionMode: "memory" },
    });
    const set = await harness.setModel({
      target: { type: "harness", harnessId: "pi" },
      update: { type: "clear" },
      adapterOptions: { sessionMode: "memory" },
    });

    if (listed.isErr()) expect(listed.error).toBeInstanceOf(HarnessAdapterListModelsError);
    if (got.isErr()) expect(got.error).toBeInstanceOf(HarnessAdapterGetModelError);
    if (set.isErr()) expect(set.error).toBeInstanceOf(HarnessAdapterSetModelError);
    expect(listed.isErr()).toBe(true);
    expect(got.isErr()).toBe(true);
    expect(set.isErr()).toBe(true);
  });
});
