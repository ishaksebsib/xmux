import type { Model, Provider } from "@opencode-ai/sdk/v2";
import type { HarnessModelRef, WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { listModels } from "../src/handlers/models";
import { prompt } from "../src/handlers/prompt";
import { getThinking, setThinking } from "../src/handlers/thinking";
import type { OpenCodeRuntime } from "../src/runtime";

const cwd = process.cwd() as WorkingDirectoryPath;
const defaultModel = { providerId: "provider-1", modelId: "model-1" } satisfies HarnessModelRef;

function createRuntime(args: {
  readonly defaultModel?: HarnessModelRef;
  readonly providers?: readonly Provider[];
  readonly calls?: unknown[];
}): OpenCodeRuntime {
  return {
    client: {
      config: {
        providers: async () => ({
          data: { providers: args.providers ?? [], default: {} },
          response: { status: 200 },
        }),
      },
      global: {
        event: async () => ({
          stream: (async function* () {
            yield { payload: { type: "session.idle", properties: { sessionID: "session-1" } } };
          })(),
        }),
      },
      session: {
        promptAsync: async (parameters: unknown) => {
          args.calls?.push(parameters);
          return { error: undefined, response: { status: 204 } };
        },
      },
    },
    thinkingLevelMap: {
      off: undefined,
      low: "low",
      high: "high",
      max: "code-extreme",
    },
    defaultModel: args.defaultModel,
    sessionModels: new Map<string, HarnessModelRef>(),
    sessionThinking: new Map(),
    close: async () => undefined,
  } as unknown as OpenCodeRuntime;
}

function createNativeModel(): Model {
  return {
    id: "model-1",
    providerID: "provider-1",
    api: { id: "model-1", url: "", npm: "" },
    family: "family-1",
    name: "Model One",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
    limit: { context: 1000, input: 900, output: 100 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: {
      low: {},
      high: {},
      "code-extreme": {},
    },
  };
}

function createNativeProvider(model: Model): Provider {
  return {
    id: "provider-1",
    name: "Provider One",
    source: "custom",
    env: [],
    options: {},
    models: { [model.id]: model },
  };
}

describe("OpenCode thinking management", () => {
  test("lists core thinking levels supported by model variants", async () => {
    const runtime = createRuntime({ providers: [createNativeProvider(createNativeModel())] });

    const listed = await listModels(runtime, { cwd, adapterOptions: {} });

    expect(listed.unwrap("models")[0]?.capabilities?.thinking).toEqual({
      supportedLevels: ["off", "low", "high", "max"],
      defaultLevel: "off",
    });
  });

  test("sets and gets session thinking using core levels", async () => {
    const runtime = createRuntime({ defaultModel });
    runtime.sessionModels.set("session-1", defaultModel);

    const selected = await setThinking(runtime, {
      target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      update: { type: "set", level: "high" },
      adapterOptions: {},
    });
    const got = await getThinking(runtime, {
      target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      adapterOptions: {},
    });

    expect(selected.unwrap("selected")).toMatchObject({ level: "high", source: "session" });
    expect(got.unwrap("got")).toMatchObject({ level: "high", source: "session" });
    expect(runtime.sessionModels.get("session-1")).toEqual({ ...defaultModel, variant: "high" });
  });

  test("applies prompt thinking before calling OpenCode", async () => {
    const calls: unknown[] = [];
    const runtime = createRuntime({ defaultModel, calls });

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "hello" }],
      thinking: "max",
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    for await (const _ of prompted.unwrap("stream")) {
      // drain stream
    }
    expect(calls[0]).toMatchObject({
      model: { providerID: "provider-1", modelID: "model-1" },
      variant: "code-extreme",
    });
    expect(runtime.sessionThinking.get("session-1")).toBe("max");
  });
});
