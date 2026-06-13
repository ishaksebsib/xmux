import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "@xmux/harness-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPiAdapter } from "../../src";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-models-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function paths() {
  return {
    agentDir: join(tempDir, "agent"),
    sessionDir: join(tempDir, "sessions"),
  };
}

function adapterOptions() {
  return {
    ...paths(),
    noTools: "all" as const,
  };
}

async function writeModelsJson() {
  const { agentDir } = paths();
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          faux: {
            name: "Faux Provider",
            api: "faux",
            apiKey: "test-key",
            baseUrl: "http://localhost:0",
            models: [
              {
                id: "faux-fast",
                name: "Faux Fast",
                reasoning: false,
                input: ["text"],
              },
              {
                id: "faux-reasoning",
                name: "Faux Reasoning",
                reasoning: true,
                thinkingLevelMap: { xhigh: "xhigh" },
                input: ["text", "image"],
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  );
}

describe("Pi model and thinking contract", () => {
  test("listModels returns stable Pi model refs and metadata", async () => {
    await writeModelsJson();
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const models = await harness.listModels({
        harnessId: "pi",
        adapterOptions: adapterOptions(),
      });

      expect(models.isOk()).toBe(true);
      const refs = models.unwrap("models").map((model) => model.ref);
      expect(refs).toEqual([
        { providerId: "faux", modelId: "faux-fast" },
        { providerId: "faux", modelId: "faux-reasoning" },
      ]);
      expect(models.unwrap("models")[1]?.capabilities?.reasoning).toBe(true);
      expect(models.unwrap("models")[1]?.adapterData.api).toBe("faux");
    } finally {
      await harness.close();
    }
  });

  test("default and per-call model selection apply on create", async () => {
    await writeModelsJson();
    const harness = createHarness({
      adapters: {
        pi: createPiAdapter({ defaultModel: { providerId: "faux", modelId: "faux-fast" } }),
      },
    });

    try {
      const fromDefault = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        adapterOptions: adapterOptions(),
      });
      expect(fromDefault.isOk()).toBe(true);
      expect(fromDefault.unwrap("default model").model).toEqual({
        providerId: "faux",
        modelId: "faux-fast",
      });

      const overridden = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        model: { providerId: "faux", modelId: "faux-reasoning" },
        adapterOptions: adapterOptions(),
      });
      expect(overridden.isOk()).toBe(true);
      expect(overridden.unwrap("overridden model").model).toEqual({
        providerId: "faux",
        modelId: "faux-reasoning",
      });
    } finally {
      await harness.close();
    }
  });

  test("harness-level model and thinking defaults can be read and updated", async () => {
    await writeModelsJson();
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const setModel = await harness.setModel({
        target: { type: "harness", harnessId: "pi" },
        update: { type: "set", model: { providerId: "faux", modelId: "faux-fast" } },
        adapterOptions: adapterOptions(),
      });
      expect(setModel.isOk()).toBe(true);
      expect(setModel.unwrap("harness model")).toMatchObject({
        model: { providerId: "faux", modelId: "faux-fast" },
        source: "harness",
      });

      const getModel = await harness.getModel({
        target: { type: "harness", harnessId: "pi" },
        adapterOptions: adapterOptions(),
      });
      expect(getModel.isOk()).toBe(true);
      expect(getModel.unwrap("current harness model").model).toEqual({
        providerId: "faux",
        modelId: "faux-fast",
      });

      const setThinking = await harness.setThinking({
        target: { type: "harness", harnessId: "pi" },
        update: { type: "set", level: "medium" },
        adapterOptions: adapterOptions(),
      });
      expect(setThinking.isOk()).toBe(true);
      expect(setThinking.unwrap("harness thinking")).toMatchObject({
        level: "medium",
        source: "harness",
      });
    } finally {
      await harness.close();
    }
  });

  test("get and set model on a live session", async () => {
    await writeModelsJson();
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        model: { providerId: "faux", modelId: "faux-fast" },
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);
      const ref = created.unwrap("created").ref;

      const selected = await harness.setModel({
        target: { type: "session", ref },
        update: { type: "set", model: { providerId: "faux", modelId: "faux-reasoning" } },
        adapterOptions: adapterOptions(),
      });
      expect(selected.isOk()).toBe(true);
      expect(selected.unwrap("selected")).toMatchObject({
        model: { providerId: "faux", modelId: "faux-reasoning" },
        source: "session",
      });

      const current = await harness.getModel({
        target: { type: "session", ref },
        adapterOptions: adapterOptions(),
      });
      expect(current.isOk()).toBe(true);
      expect(current.unwrap("current").model).toEqual({
        providerId: "faux",
        modelId: "faux-reasoning",
      });
    } finally {
      await harness.close();
    }
  });

  test("default thinking applies on create and live thinking can be changed", async () => {
    await writeModelsJson();
    const harness = createHarness({
      adapters: {
        pi: createPiAdapter({
          defaultModel: { providerId: "faux", modelId: "faux-reasoning" },
          defaultThinking: "high",
        }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);
      const ref = created.unwrap("created").ref;

      const initial = await harness.getThinking({
        target: { type: "session", ref },
        adapterOptions: adapterOptions(),
      });
      expect(initial.isOk()).toBe(true);
      expect(initial.unwrap("initial thinking")).toMatchObject({
        level: "high",
        source: "session",
      });

      const updated = await harness.setThinking({
        target: { type: "session", ref },
        update: { type: "set", level: "low" },
        adapterOptions: adapterOptions(),
      });
      expect(updated.isOk()).toBe(true);
      expect(updated.unwrap("updated thinking")).toMatchObject({ level: "low", source: "session" });
    } finally {
      await harness.close();
    }
  });
});
