import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { createHarness, harnessLogEvents } from "../src";
import { collectAsync, createMockLogger, createTestAdapter } from "./test-utils";

describe("harness logging", () => {
  test("prompt logs contain safe metadata and omit prompt content and adapter options", async () => {
    const logger = createMockLogger();
    const harness = createHarness({
      logger,
      adapters: {
        pi: createTestAdapter<
          "pi",
          { readonly sessionMode: "memory"; readonly token: string },
          { readonly sessionFile: string }
        >({
          id: "pi",
          handles: { opens: [], closes: [] },
          createSession: async () =>
            Result.ok({ sessionId: "pi-1", adapterData: { sessionFile: "created" } }),
          operations: {
            prompt: async (input) =>
              Result.ok(
                (async function* () {
                  yield { type: "run", phase: "started", ref: input.ref } as const;
                  yield {
                    type: "content",
                    phase: "delta",
                    kind: "text",
                    ref: input.ref,
                    delta: "do not log stream delta",
                  } as const;
                  yield { type: "run", phase: "completed", ref: input.ref, reason: "stop" } as const;
                })(),
              ),
          },
        }),
      },
    });

    const prompted = await harness.prompt({
      ref: { harnessId: "pi", sessionId: "session-1" },
      cwd: process.cwd(),
      content: { type: "text", text: "do not log prompt content" },
      adapterOptions: { sessionMode: "memory", token: "secret-token" },
    });

    expect(prompted.isOk()).toBe(true);
    await collectAsync(prompted.unwrap("prompt stream"));

    expect(logger.debug).toHaveBeenCalledWith(
      harnessLogEvents.operationBegin,
      expect.objectContaining({
        component: "@xmux/harness-core",
        operation: "prompt",
        harnessId: "pi",
        sessionId: "session-1",
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      harnessLogEvents.operationSuccess,
      expect.objectContaining({
        operation: "prompt",
        harnessId: "pi",
        sessionId: "session-1",
        result: "ok",
        durationMs: expect.any(Number),
      }),
    );

    const serializedLogs = JSON.stringify([
      logger.trace.mock.calls,
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(serializedLogs).not.toContain("do not log prompt content");
    expect(serializedLogs).not.toContain("do not log stream delta");
    expect(serializedLogs).not.toContain("secret-token");
    expect(serializedLogs).not.toContain(process.cwd());
  });
});
