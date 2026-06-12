import {
  HarnessAdapterListModelsError,
  HarnessAdapterSetModelError,
  HarnessAdapterSetThinkingError,
  createHarness,
} from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../../src";
import { nativeModel, nativeProvider } from "../fixtures/builders";
import { collectAsync } from "../fixtures/collect";
import { nextStepStarted, sessionIdle } from "../fixtures/events";
import { startFakeOpenCodeServer } from "../fixtures/fake-opencode-server";

function createOpenCodeHarness(baseUrl: string) {
  return createHarness({
    adapters: {
      opencode: createOpenCodeAdapter({
        mode: "external",
        baseUrl,
        defaultModel: { providerId: "provider-1", modelId: "model-1" },
        thinkingLevelMap: { off: undefined, low: "low", high: "high", max: "code-extreme" },
      }),
    },
  });
}

describe("OpenCode models and thinking contract", () => {
  test("lists models with normalized metadata and excludes deprecated models by default", async () => {
    const active = nativeModel({
      id: "model-1",
      release_date: "2026-01-01",
      status: "alpha",
      variants: { low: {}, high: {}, "code-extreme": {} },
    });
    const old = nativeModel({ id: "old-model", release_date: "2024-01-01" });
    const deprecated = nativeModel({ id: "deprecated", status: "deprecated" });
    const fakeOpenCode = await startFakeOpenCodeServer({
      providers: [
        nativeProvider({
          models: { [active.id]: active, [old.id]: old, [deprecated.id]: deprecated },
        }),
      ],
    });
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const listed = await harness.listModels({ harnessId: "opencode", cwd: process.cwd() });
      const listedWithUnavailable = await harness.listModels({
        harnessId: "opencode",
        cwd: process.cwd(),
        includeUnavailable: true,
      });

      expect(listed.unwrap("models")).toEqual([
        expect.objectContaining({
          ref: { providerId: "provider-1", modelId: "model-1" },
          providerName: "Provider One",
          status: "beta",
          available: true,
          capabilities: expect.objectContaining({
            tools: true,
            reasoning: true,
            thinking: { supportedLevels: ["off", "low", "high", "max"], defaultLevel: "off" },
            input: ["text", "image"],
          }),
          limits: { context: 1000, input: 900, output: 100 },
          cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
        }),
        expect.objectContaining({ ref: { providerId: "provider-1", modelId: "old-model" } }),
      ]);
      expect(listedWithUnavailable.unwrap("all models")).toHaveLength(3);
      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({ method: "GET", path: "/config/providers" }),
      );
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps model list request failures at the public boundary", async () => {
    const harness = createOpenCodeHarness("http://127.0.0.1:1");

    try {
      const listed = await harness.listModels({ harnessId: "opencode", cwd: process.cwd() });

      expect(listed.isErr()).toBe(true);
      if (listed.isErr()) expect(listed.error).toBeInstanceOf(HarnessAdapterListModelsError);
    } finally {
      await harness.close();
    }
  });

  test("requires providerId and respects harness/session model precedence", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const invalid = await harness.setModel({
        target: { type: "harness", harnessId: "opencode" },
        update: { type: "set", model: { modelId: "model-without-provider" } },
      });
      expect(invalid.isErr()).toBe(true);
      if (invalid.isErr()) expect(invalid.error).toBeInstanceOf(HarnessAdapterSetModelError);

      const initialSession = await harness.getModel({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      });
      expect(initialSession.unwrap("initial")).toMatchObject({ source: "harness" });

      const setSession = await harness.setModel({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
        update: { type: "set", model: { providerId: "provider-2", modelId: "model-2" } },
      });
      expect(setSession.unwrap("session model")).toMatchObject({
        source: "session",
        model: { providerId: "provider-2", modelId: "model-2" },
      });
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("sets and clears harness and session thinking selections", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const setHarness = await harness.setThinking({
        target: { type: "harness", harnessId: "opencode" },
        update: { type: "set", level: "high" },
      });
      expect(setHarness.unwrap("set harness thinking")).toMatchObject({
        level: "high",
        source: "harness",
      });

      const clearedHarness = await harness.setThinking({
        target: { type: "harness", harnessId: "opencode" },
        update: { type: "clear" },
      });
      expect(clearedHarness.unwrap("cleared harness thinking")).toMatchObject({
        level: "off",
        source: "native",
      });

      const setSession = await harness.setThinking({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
        update: { type: "set", level: "low" },
      });
      expect(setSession.unwrap("set session thinking")).toMatchObject({
        level: "low",
        source: "session",
      });

      const clearedSession = await harness.setThinking({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
        update: { type: "clear" },
      });
      expect(clearedSession.unwrap("cleared session thinking")).toMatchObject({ source: "unset" });
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("wraps unsupported thinking levels as adapter errors", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const selected = await harness.setThinking({
        target: { type: "harness", harnessId: "opencode" },
        update: { type: "set", level: "xhigh" },
      });

      expect(selected.isErr()).toBe(true);
      if (selected.isErr()) expect(selected.error).toBeInstanceOf(HarnessAdapterSetThinkingError);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });

  test("applies thinking variants to prompt model payloads and persists explicit selection", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    fakeOpenCode.enqueueEvents(
      nextStepStarted("session-1", {
        model: { providerID: "provider-1", id: "model-1", variant: "code-extreme" },
      }),
      sessionIdle("session-1"),
    );
    const harness = createOpenCodeHarness(fakeOpenCode.url);

    try {
      const prompted = await harness.prompt({
        ref: { harnessId: "opencode", sessionId: "session-1" },
        cwd: process.cwd(),
        content: [{ type: "text", text: "think" }],
        thinking: "max",
      });
      const events = await collectAsync(prompted.unwrap("prompt stream"));

      expect(events).toContainEqual(
        expect.objectContaining({ type: "turn", phase: "started", thinking: "max" }),
      );
      expect(fakeOpenCode.requests).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/session/session-1/prompt_async",
          body: expect.objectContaining({
            model: { providerID: "provider-1", modelID: "model-1" },
            variant: "code-extreme",
          }),
        }),
      );

      const thinking = await harness.getThinking({
        target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
      });
      expect(thinking.unwrap("thinking")).toMatchObject({ level: "max", source: "session" });
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });
});
