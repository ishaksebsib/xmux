import path from "node:path";
import { describe, expect, test } from "vitest";
import { mergePiCreateOptions, normalizePiAdapterConfig } from "../../src/config";

describe("Pi adapter config", () => {
  test("default config normalizes without requiring options", () => {
    expect(normalizePiAdapterConfig(undefined)).toEqual({});
  });

  test("agentDir and sessionDir are normalized to absolute paths", () => {
    expect(
      normalizePiAdapterConfig({
        agentDir: "./.pi-agent",
        sessionDir: "./.pi-sessions",
      }),
    ).toEqual({
      agentDir: path.resolve("./.pi-agent"),
      sessionDir: path.resolve("./.pi-sessions"),
    });
  });

  test("per-call adapterOptions override package defaults", () => {
    const config = normalizePiAdapterConfig({
      agentDir: "/default/agent",
      sessionDir: "/default/sessions",
      tools: ["read"],
      excludeTools: ["write"],
      noTools: "builtin",
    });

    expect(
      mergePiCreateOptions(config, {
        agentDir: "./call-agent",
        sessionDir: "./call-sessions",
        sessionPath: "./session.jsonl",
        parentSession: "parent-1",
        tools: ["bash"],
        excludeTools: ["edit"],
        noTools: "all",
      }),
    ).toEqual({
      agentDir: path.resolve("./call-agent"),
      sessionDir: path.resolve("./call-sessions"),
      sessionPath: path.resolve("./session.jsonl"),
      parentSession: "parent-1",
      tools: ["bash"],
      excludeTools: ["edit"],
      noTools: "all",
    });
  });

  test("adapter defaults fill missing per-call options", () => {
    const config = normalizePiAdapterConfig({
      agentDir: "./default-agent",
      sessionDir: "./default-sessions",
      tools: ["read"],
      excludeTools: ["write"],
      noTools: "builtin",
    });

    expect(mergePiCreateOptions(config, { parentSession: "parent-1" })).toEqual({
      agentDir: path.resolve("./default-agent"),
      sessionDir: path.resolve("./default-sessions"),
      parentSession: "parent-1",
      tools: ["read"],
      excludeTools: ["write"],
      noTools: "builtin",
    });
  });

  test("config objects and array values are not mutated", () => {
    const tools = ["read"];
    const excludeTools = ["write"];
    const config = {
      agentDir: "./agent",
      sessionDir: "./sessions",
      defaultModel: { providerId: "faux", modelId: "faux-fast" },
      tools,
      excludeTools,
      noTools: "builtin" as const,
    };

    const normalized = normalizePiAdapterConfig(config);
    const merged = mergePiCreateOptions(normalized, {
      tools: ["bash"],
      excludeTools: ["edit"],
    });

    expect(config).toEqual({
      agentDir: "./agent",
      sessionDir: "./sessions",
      defaultModel: { providerId: "faux", modelId: "faux-fast" },
      tools: ["read"],
      excludeTools: ["write"],
      noTools: "builtin",
    });
    expect(normalized.tools).toEqual(["read"]);
    expect(normalized.tools).not.toBe(tools);
    expect(normalized.excludeTools).not.toBe(excludeTools);
    expect(normalized.defaultModel).toEqual(config.defaultModel);
    expect(normalized.defaultModel).not.toBe(config.defaultModel);
    expect(merged.tools).toEqual(["bash"]);
    expect(merged.excludeTools).toEqual(["edit"]);
  });
});
