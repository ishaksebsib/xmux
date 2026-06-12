import { createHarness, type HarnessLogger } from "@xmux/harness-core";
import { describe, expect, test, vi } from "vitest";
import { createOpenCodeAdapter } from "../../src";
import { openCodeLogEvents } from "../../src/logger";
import { startFakeOpenCodeServer } from "../fixtures/fake-opencode-server";

function createMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies HarnessLogger;
}

describe("OpenCode logging contract", () => {
  test("logs lifecycle and operation metadata without sensitive payloads", async () => {
    const fakeOpenCode = await startFakeOpenCodeServer();
    const logger = createMockLogger();
    const harness = createHarness({
      logger,
      adapters: {
        opencode: createOpenCodeAdapter({ mode: "external", baseUrl: fakeOpenCode.url }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "do not log this title",
      });

      expect(created.isOk()).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        openCodeLogEvents.openBegin,
        expect.objectContaining({
          component: "@xmux/harness-opencode",
          packageName: "@xmux/harness-opencode",
          harnessId: "opencode",
          operation: "openAdapter",
          mode: "external",
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        openCodeLogEvents.operationBegin,
        expect.objectContaining({
          component: "@xmux/harness-opencode",
          packageName: "@xmux/harness-opencode",
          harnessId: "opencode",
          operation: "createSession",
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        openCodeLogEvents.operationSuccess,
        expect.objectContaining({ operation: "createSession", durationMs: expect.any(Number) }),
      );

      const serializedLogs = JSON.stringify(logger.debug.mock.calls);
      expect(serializedLogs).not.toContain("do not log this title");
      expect(serializedLogs).not.toContain(fakeOpenCode.url);
    } finally {
      await harness.close();
      await fakeOpenCode.close();
    }
  });
});
