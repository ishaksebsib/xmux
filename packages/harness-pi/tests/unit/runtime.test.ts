import { describe, expect, test, vi } from "vitest";
import { normalizePiAdapterConfig } from "../../src/config";
import { openRuntime, type PiSessionHandle } from "../../src/runtime";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

describe("Pi runtime", () => {
  test("opens with normalized config and empty session state", async () => {
    const config = normalizePiAdapterConfig({
      defaultModel: { providerId: "faux", modelId: "faux-fast" },
      defaultThinking: "medium",
    });

    const opened = await openRuntime(config);

    expect(opened.isOk()).toBe(true);
    const runtime = opened.unwrap("runtime should open");
    expect(runtime.config).toEqual(config);
    expect(runtime.sessions.size).toBe(0);
    expect(runtime.defaultModel).toEqual({ providerId: "faux", modelId: "faux-fast" });
    expect(runtime.defaultThinking).toBe("medium");
  });

  test("close disposes every live session and clears the session map", async () => {
    const runtime = (await openRuntime(normalizePiAdapterConfig(undefined))).unwrap(
      "runtime should open",
    );
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();

    runtime.sessions.set("first", createHandle("first", firstDispose));
    runtime.sessions.set("second", createHandle("second", secondDispose));

    await runtime.close();

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(runtime.sessions.size).toBe(0);
  });

  test("close still disposes remaining sessions and clears state when one dispose fails", async () => {
    const runtime = (await openRuntime(normalizePiAdapterConfig(undefined))).unwrap(
      "runtime should open",
    );
    const failure = new Error("dispose failed");
    const firstDispose = vi.fn(() => {
      throw failure;
    });
    const secondDispose = vi.fn();

    runtime.sessions.set("first", createHandle("first", firstDispose));
    runtime.sessions.set("second", createHandle("second", secondDispose));

    await expect(runtime.close()).rejects.toBe(failure);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(runtime.sessions.size).toBe(0);
  });
});

function createHandle(sessionId: string, dispose: () => void): PiSessionHandle {
  return {
    session: {} as AgentSession,
    cwd: process.cwd(),
    sessionId,
    dispose,
  };
}
