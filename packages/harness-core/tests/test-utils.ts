import { Result } from "better-result";
import {
  defineHarnessAdapter,
  type HarnessAdapterDefinition,
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

export async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

export function createTestAdapter<
  THarnessId extends string,
  TAdapterOptions extends Record<string, unknown>,
  TAdapterSession extends Record<string, unknown>,
  TAdapterModel extends Record<string, unknown> = Record<string, unknown>,
>(args: {
  readonly id: THarnessId;
  readonly handles: OpenedAdapterHandles;
  readonly openError?: unknown;
  readonly onOpenContext?: (context: OpenHarnessAdapterContext) => void;
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
        },
      });
    },
  });
}
