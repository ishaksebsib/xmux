import type { Model, Provider } from "@opencode-ai/sdk/v2";
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
  readonly status?: Model["status"];
  readonly releaseDate?: string;
  readonly variants?: NonNullable<Model["variants"]>;
}): Model {
  return {
    id: args.id,
    providerID: "provider-1",
    api: { id: args.id, url: "", npm: "" },
    family: "family-1",
    name: `${args.id} name`,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, image: true, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
    limit: { context: 1000, input: 900, output: 100 },
    status: args.status ?? "active",
    options: {},
    headers: {},
    release_date: args.releaseDate ?? "2026-01-01",
    variants: args.variants ?? {},
  };
}

function createNativeProvider(args: { readonly models?: readonly Model[] }): Provider {
  return {
    id: "provider-1",
    name: "Provider One",
    source: "custom",
    env: [],
    options: {},
    models: Object.fromEntries((args.models ?? []).map((model) => [model.id, model])),
  };
}

function createModelRuntime(args: {
  readonly defaultModel?: HarnessModelRef;
  readonly providers?: readonly Provider[];
}): OpenCodeRuntime {
  return {
    client: {
      config: {
        providers: async () => ({
          data: { providers: args.providers ?? [], default: {} },
          response: { status: 200 },
        }),
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
  readonly events?: readonly unknown[];
}) {
  return {
    client: {
      global: {
        event: async () => ({
          stream: (async function* () {
            for (const event of args.events ?? [
              { payload: { type: "session.idle", properties: { sessionID: "session-1" } } },
            ]) {
              yield event;
            }
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
      providers: [
        createNativeProvider({
          models: [
            createNativeModel({ id: "old-model", releaseDate: "2024-01-01" }),
            createNativeModel({
              id: "model-1",
              releaseDate: "2026-01-01",
              variants: { fast: { headers: {}, body: {}, aisdk: { provider: {}, request: {} } } },
            }),
            createNativeModel({ id: "deprecated", status: "deprecated" }),
          ],
        }),
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
        providerName: "Provider One",
        capabilities: expect.objectContaining({ input: ["text", "image"] }),
        limits: { context: 1000, input: 900, output: 100 },
        cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
      }),
      expect.objectContaining({
        ref: { providerId: "provider-1", modelId: "model-1", variant: "fast" },
        adapterData: expect.objectContaining({ variant: expect.objectContaining({ id: "fast" }) }),
      }),
      expect.objectContaining({
        ref: { providerId: "provider-1", modelId: "old-model", variant: undefined },
      }),
    ]);

    const listedWithUnavailable = await listModels(runtime, {
      cwd,
      includeUnavailable: true,
      adapterOptions: {},
    });

    expect(listedWithUnavailable.isOk()).toBe(true);
    expect(listedWithUnavailable.unwrap("models")).toHaveLength(4);
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

  test("learns the native OpenCode-selected model from prompt events", async () => {
    const calls: unknown[] = [];
    const runtime = createPromptRuntime({
      calls,
      events: [
        {
          payload: {
            type: "message.updated",
            properties: {
              sessionID: "session-1",
              info: {
                id: "message-1",
                role: "assistant",
                agent: "build",
                providerID: "provider-native",
                modelID: "model-native",
                time: { completed: undefined },
              },
            },
          },
        },
        { payload: { type: "session.idle", properties: { sessionID: "session-1" } } },
      ],
    });

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    await collectAsync(prompted.unwrap("stream"));

    expect(runtime.sessionModels.get("session-1")).toEqual({
      providerId: "provider-native",
      modelId: "model-native",
    });
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
