import { Result } from "better-result";
import { vi } from "vitest";
import {
  defineHarnessAdapter,
  type HarnessAdapterDefinition,
  type HarnessLogger,
  type OpenHarnessAdapterContext,
  type OpenedHarnessAdapter,
} from "../src";

export type PiAdapterInput = {
  readonly sessionMode: "memory" | "persistent";
};

export type PiAdapterSession = {
  readonly sessionFile: string;
};

export type OpenedAdapterHandles = {
  readonly opens: string[];
  readonly closes: string[];
};

type LoggerMock = ReturnType<typeof vi.fn>;

export type MockHarnessLogger = HarnessLogger & {
  readonly trace: LoggerMock;
  readonly debug: LoggerMock;
  readonly info: LoggerMock;
  readonly warn: LoggerMock;
  readonly error: LoggerMock;
};

export async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

export function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export function createMockLogger(): MockHarnessLogger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies HarnessLogger;
}

export function createThrowingLogger(): HarnessLogger {
  const fail = vi.fn(() => {
    throw new Error("logger failed");
  });

  return {
    trace: fail,
    debug: fail,
    info: fail,
    warn: fail,
    error: fail,
  };
}

export function createTestAdapter<
  THarnessId extends string,
  TAdapterOptions extends Record<string, unknown>,
  TAdapterSession extends Record<string, unknown>,
  TAdapterModel extends Record<string, unknown> = Record<string, unknown>,
>(args: {
  readonly id: THarnessId;
  readonly handles: OpenedAdapterHandles;
  readonly openDelay?: Promise<unknown>;
  readonly openError?: unknown;
  readonly openThrow?: unknown;
  readonly closeThrow?: unknown;
  readonly onOpenContext?: (context: OpenHarnessAdapterContext) => void;
  readonly onClose?: () => void;
  readonly createSession: OpenedHarnessAdapter<
    THarnessId,
    TAdapterOptions,
    TAdapterSession,
    TAdapterModel
  >["createSession"];
  readonly operations?: Partial<
    Pick<
      OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel>,
      | "abort"
      | "deleteSession"
      | "getModel"
      | "getSession"
      | "getThinking"
      | "listModels"
      | "listSessions"
      | "prompt"
      | "respondInteraction"
      | "resumeSession"
      | "setModel"
      | "setThinking"
    >
  >;
}): HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel> {
  return defineHarnessAdapter({
    id: args.id,
    async open(context) {
      args.handles.opens.push(args.id);
      args.onOpenContext?.(context);
      await args.openDelay;

      if (args.openThrow !== undefined) {
        throw args.openThrow;
      }

      if (args.openError !== undefined) {
        return Result.err(args.openError);
      }

      return Result.ok({
        id: args.id,
        createSession: args.createSession,
        resumeSession: async () => Result.err(new Error("not implemented in test adapter")),
        listSessions: async () => Result.err(new Error("not implemented in test adapter")),
        getSession: async () => Result.err(new Error("not implemented in test adapter")),
        prompt: async () => Result.err(new Error("not implemented in test adapter")),
        deleteSession: async () => Result.err(new Error("not implemented in test adapter")),
        abort: async () => Result.err(new Error("not implemented in test adapter")),
        ...args.operations,
        close: async () => {
          args.handles.closes.push(args.id);
          args.onClose?.();
          if (args.closeThrow !== undefined) {
            throw args.closeThrow;
          }
        },
      });
    },
  });
}
