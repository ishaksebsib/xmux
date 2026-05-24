import type { ModelV2Info } from "@opencode-ai/sdk/v2";
import type { HarnessModelRef, WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { OpenCodeModelSelectionError } from "../src";
import { createSession } from "../src/handlers/create-session";
import { getModel, listModels, setModel } from "../src/handlers/models";
import { prompt } from "../src/handlers/prompt";
import type { OpenCodeRuntime } from "../src/runtime";

const cwd = process.cwd() as WorkingDirectoryPath;
const defaultModel = { providerId: "provider-1", modelId: "model-1" } satisfies HarnessModelRef;
const variantModel = {
  providerId: "provider-1",
  modelId: "model-1",
  variant: "fast",
} satisfies HarnessModelRef;

async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function createNativeModel(args: {
  readonly id: string;
  readonly enabled?: boolean;
  readonly variants?: ModelV2Info["variants"];
}): ModelV2Info {
  return {
    id: args.id,
    apiID: args.id,
    providerID: "provider-1",
    family: "family-1",
    name: `${args.id} name`,
    endpoint: { type: "unknown" },
    capabilities: { tools: true, input: ["text", "image", "unsupported"], output: ["text"] },
    options: { headers: {}, body: {}, aisdk: { provider: {}, request: {} } },
    variants: args.variants ?? [],
    time: { released: 1 },
    cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
    status: "active",
    enabled: args.enabled ?? true,
    limit: { context: 1000, input: 900, output: 100 },
  };
}

function createModelRuntime(args: {
  readonly defaultModel?: HarnessModelRef;
  readonly models?: readonly ModelV2Info[];
}): OpenCodeRuntime {
  return {
    client: {
      v2: {
        model: {
          list: async () => ({ data: args.models ?? [], response: { status: 200 } }),
        },
      },
    },
    defaultModel: args.defaultModel,
    sessionModels: new Map(),
    close: async () => undefined,
  } as unknown as OpenCodeRuntime;
}

function createPromptRuntime(args: {
  readonly defaultModel?: HarnessModelRef;
  readonly calls: unknown[];
}) {
  return {
    client: {
      global: {
        event: async () => ({
          stream: (async function* () {
            yield {
              payload: { type: "session.idle", properties: { sessionID: "session-1" } },
            };
          })(),
        }),
      },
      session: {
        promptAsync: async (parameters: unknown) => {
          args.calls.push(parameters);
          return { error: undefined, response: { status: 204 } };
        },
      },
    },
    defaultModel: args.defaultModel,
    sessionModels: new Map<string, HarnessModelRef>(),
    close: async () => undefined,
  } as unknown as OpenCodeRuntime;
}

describe("OpenCode model management", () => {
  test("lists models and variants with normalized metadata", async () => {
    const runtime = createModelRuntime({
      models: [
        createNativeModel({
          id: "model-1",
          variants: [{ id: "fast", headers: {}, body: {}, aisdk: { provider: {}, request: {} } }],
        }),
        createNativeModel({ id: "disabled", enabled: false }),
      ],
    });

    const listed = await listModels(runtime, { cwd, adapterOptions: {} });

    expect(listed.isOk()).toBe(true);
    expect(listed.unwrap("models")).toEqual([
      expect.objectContaining({
        harnessId: "opencode",
        ref: { providerId: "provider-1", modelId: "model-1", variant: undefined },
        name: "model-1 name",
        available: true,
        capabilities: expect.objectContaining({ input: ["text", "image"] }),
        limits: { context: 1000, input: 900, output: 100 },
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
      }),
      expect.objectContaining({
        ref: { providerId: "provider-1", modelId: "model-1", variant: "fast" },
        adapterData: expect.objectContaining({ variant: expect.objectContaining({ id: "fast" }) }),
      }),
    ]);

    const listedWithUnavailable = await listModels(runtime, {
      cwd,
      includeUnavailable: true,
      adapterOptions: {},
    });

    expect(listedWithUnavailable.isOk()).toBe(true);
    expect(listedWithUnavailable.unwrap("models")).toHaveLength(3);
  });

  test("sets, gets, and clears harness and session model selections", async () => {
    const runtime = createModelRuntime({ defaultModel });

    const initialSession = await getModel(runtime, {
      target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      adapterOptions: {},
    });
    expect(initialSession.unwrap("selected")).toMatchObject({
      model: defaultModel,
      source: "harness",
    });

    const setSession = await setModel(runtime, {
      target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      update: { type: "set", model: variantModel },
      adapterOptions: {},
    });
    expect(setSession.unwrap("selected")).toMatchObject({ model: variantModel, source: "session" });

    const clearedSession = await setModel(runtime, {
      target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      update: { type: "clear" },
      adapterOptions: {},
    });
    expect(clearedSession.unwrap("selected")).toMatchObject({
      model: defaultModel,
      source: "harness",
    });

    const clearedHarness = await setModel(runtime, {
      target: { type: "harness", harnessId: "opencode" },
      update: { type: "clear" },
      adapterOptions: {},
    });
    expect(clearedHarness.unwrap("selected")).toMatchObject({ source: "unset" });
  });

  test("rejects model selections without providerId", async () => {
    const runtime = createModelRuntime({});

    const selected = await setModel(runtime, {
      target: { type: "harness", harnessId: "opencode" },
      update: { type: "set", model: { modelId: "model-1" } },
      adapterOptions: {},
    });

    expect(selected.isErr()).toBe(true);
    if (selected.isErr()) expect(selected.error).toBeInstanceOf(OpenCodeModelSelectionError);
  });

  test("stores explicit and default models when creating sessions", async () => {
    const sessionModels = new Map<string, HarnessModelRef>();
    const runtime = {
      client: {
        session: {
          create: async () => ({
            data: {
              id: "session-1",
              slug: "session-1-slug",
              projectID: "project-1",
              directory: cwd,
              title: "created",
              version: "1.0.0",
              time: { created: 1, updated: 1 },
            },
          }),
        },
      },
      defaultModel,
      sessionModels,
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const created = await createSession(runtime, { cwd, model: variantModel, adapterOptions: {} });

    expect(created.isOk()).toBe(true);
    expect(created.unwrap("created")).toMatchObject({
      sessionId: "session-1",
      model: variantModel,
    });
    expect(sessionModels.get("session-1")).toEqual(variantModel);
  });

  test("passes resolved prompt models to OpenCode and persists explicit selections", async () => {
    const calls: unknown[] = [];
    const runtime = createPromptRuntime({ defaultModel, calls });

    const first = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "hello" }],
      model: variantModel,
      adapterOptions: {},
    });
    expect(first.isOk()).toBe(true);
    await collectAsync(first.unwrap("stream"));

    const second = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "again" }],
      adapterOptions: {},
    });
    expect(second.isOk()).toBe(true);
    await collectAsync(second.unwrap("stream"));

    expect(calls).toEqual([
      expect.objectContaining({
        model: { providerID: "provider-1", modelID: "model-1" },
        variant: "fast",
      }),
      expect.objectContaining({
        model: { providerID: "provider-1", modelID: "model-1" },
        variant: "fast",
      }),
    ]);
  });
});
