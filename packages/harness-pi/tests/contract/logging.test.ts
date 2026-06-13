import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Result } from "better-result";
import { describe, expect, test, vi } from "vitest";
import type { HarnessLogger, WorkingDirectoryPath } from "@xmux/harness-core";
import { createPiAdapter, PiNotImplementedError } from "../../src";
import { createPiLogScope, logPiOperation, piLogEvents } from "../../src/logger";

function createMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies HarnessLogger;
}

async function openPiAdapter(logger: HarnessLogger) {
  const opened = await createPiAdapter().open({ logger });
  expect(opened.isOk()).toBe(true);
  return opened.unwrap("Pi adapter should open");
}

describe("Pi logging contract", () => {
  test("open and close log begin/success with sdk metadata", async () => {
    const logger = createMockLogger();
    const opened = await openPiAdapter(logger);

    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.openBegin,
      expect.objectContaining({
        component: "@xmux/harness-pi",
        packageName: "@xmux/harness-pi",
        harnessId: "pi",
        adapter: "pi",
        operation: "openAdapter",
        mode: "sdk",
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.openSuccess,
      expect.objectContaining({
        operation: "openAdapter",
        mode: "sdk",
        result: "ok",
        durationMs: expect.any(Number),
      }),
    );

    await opened.close();

    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.closeBegin,
      expect.objectContaining({ operation: "closeAdapter", mode: "sdk" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.closeSuccess,
      expect.objectContaining({
        operation: "closeAdapter",
        mode: "sdk",
        result: "ok",
        durationMs: expect.any(Number),
      }),
    );
  });

  test("opened adapter operations log begin and terminal metadata", async () => {
    const logger = createMockLogger();
    const opened = await openPiAdapter(logger);
    const tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-logging-"));
    const cwd = process.cwd() as WorkingDirectoryPath;
    const adapterOptions = {
      agentDir: join(tempDir, "agent"),
      sessionDir: join(tempDir, "sessions"),
      noTools: "all" as const,
    };

    try {
      const created = await opened.createSession({ cwd, adapterOptions });
      expect(created.isOk()).toBe(true);
      const ref = { harnessId: "pi", sessionId: created.unwrap("created").sessionId } as const;
      const missingRef = { harnessId: "pi", sessionId: "missing-session" } as const;

      const calls = [
        ["resumeSession", () => opened.resumeSession({ sessionId: "missing-session", adapterOptions })],
        ["listSessions", () => opened.listSessions({ adapterOptions })],
        ["getSession", () => opened.getSession({ ref, adapterOptions })],
        [
          "prompt",
          () =>
            opened.prompt({
              ref,
              cwd,
              content: [{ type: "text", text: "do not log prompt text" }],
              adapterOptions,
            }),
        ],
        ["listModels", () => opened.listModels!({ adapterOptions })],
        ["getModel", () => opened.getModel!({ target: { type: "harness", harnessId: "pi" }, adapterOptions })],
        [
          "setModel",
          () =>
            opened.setModel!({
              target: { type: "harness", harnessId: "pi" },
              update: { type: "set", model: { providerId: "faux", modelId: "faux-fast" } },
              adapterOptions,
            }),
        ],
        ["getThinking", () => opened.getThinking!({ target: { type: "harness", harnessId: "pi" }, adapterOptions })],
        [
          "setThinking",
          () =>
            opened.setThinking!({
              target: { type: "harness", harnessId: "pi" },
              update: { type: "set", level: "medium" },
              adapterOptions,
            }),
        ],
        ["abort", () => opened.abort({ ref, adapterOptions })],
        ["deleteSession", () => opened.deleteSession({ ref, adapterOptions })],
        ["getSession", () => opened.getSession({ ref: missingRef, adapterOptions })],
      ] as const;

      for (const [, run] of calls) {
        await run();
      }

      const operations = [
        "createSession",
        ...calls.map(([operation]) => operation),
      ];
      for (const operation of operations) {
        expect(logger.debug).toHaveBeenCalledWith(
          piLogEvents.operationBegin,
          expect.objectContaining({ operation, mode: "sdk" }),
        );
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringMatching(/^xmux\.pi\.operation\.(success|failure)$/),
          expect.objectContaining({
            operation,
            mode: "sdk",
            durationMs: expect.any(Number),
          }),
        );
      }

      expect(logger.debug).toHaveBeenCalledWith(
        piLogEvents.operationFailure,
        expect.objectContaining({
          operation: "getSession",
          result: "error",
          error: expect.objectContaining({
            message: expect.stringContaining("Pi session not found"),
          }),
        }),
      );

      const serializedLogs = JSON.stringify(logger.debug.mock.calls);
      expect(serializedLogs).not.toContain("do not log prompt text");
    } finally {
      await opened.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("logPiOperation records success, expected failure, and thrown failure", async () => {
    const logger = createMockLogger();
    const scope = createPiLogScope({ logger });

    await expect(
      logPiOperation({
        logger: scope,
        operation: "listModels",
        run: async () => Result.ok(["faux-fast"]),
      }),
    ).resolves.toSatisfy((result: Result<readonly string[], never>) => result.isOk());

    await logPiOperation({
      logger: scope,
      operation: "getSession",
      sessionId: "missing",
      run: async () => Result.err(new PiNotImplementedError({ operation: "getSession" })),
    });

    const thrown = new Error("boom");
    await expect(
      logPiOperation({
        logger: scope,
        operation: "prompt",
        sessionId: "session-1",
        run: async () => {
          throw thrown;
        },
      }),
    ).rejects.toBe(thrown);

    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.operationSuccess,
      expect.objectContaining({ operation: "listModels", mode: "sdk", result: "ok" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.operationFailure,
      expect.objectContaining({
        operation: "getSession",
        sessionId: "missing",
        mode: "sdk",
        result: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("Pi adapter operation is not implemented yet: getSession"),
        }),
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      piLogEvents.operationFailure,
      expect.objectContaining({
        operation: "prompt",
        sessionId: "session-1",
        mode: "sdk",
        result: "error",
        error: expect.objectContaining({ name: "Error", message: "boom" }),
      }),
    );
  });
});
