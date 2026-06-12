import { vi } from "vitest";
import type { ChatLogger } from "../../src";
export { createMockLogger } from "./test-adapter";
export function createThrowingLogger(): ChatLogger {
  return {
    trace: vi.fn(() => {
      throw new Error("logger failed");
    }),
    debug: vi.fn(() => {
      throw new Error("logger failed");
    }),
    info: vi.fn(() => {
      throw new Error("logger failed");
    }),
    warn: vi.fn(() => {
      throw new Error("logger failed");
    }),
    error: vi.fn(() => {
      throw new Error("logger failed");
    }),
  };
}
