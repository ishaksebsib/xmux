import {
  createHarnessLogScope,
  logHarnessResult,
  startHarnessLogTimer,
  type HarnessLogger,
  type HarnessLogEventName,
  type HarnessLogMetadata,
  type HarnessLogOperation,
  type HarnessLogScope,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";

export const openCodeLogEvents = {
  openBegin: "xmux.opencode.open.begin",
  openSuccess: "xmux.opencode.open.success",
  openFailure: "xmux.opencode.open.failure",
  closeBegin: "xmux.opencode.close.begin",
  closeSuccess: "xmux.opencode.close.success",
  closeFailure: "xmux.opencode.close.failure",
  operationBegin: "xmux.opencode.operation.begin",
  operationSuccess: "xmux.opencode.operation.success",
  operationFailure: "xmux.opencode.operation.failure",
} as const satisfies Record<string, `xmux.opencode.${string}`>;

export type OpenCodeLogEventName = (typeof openCodeLogEvents)[keyof typeof openCodeLogEvents];
export type OpenCodeLogScope = HarnessLogScope<OpenCodeLogEventName | HarnessLogEventName>;

export function createOpenCodeLogScope(args: {
  readonly logger?: HarnessLogger;
  readonly mode: string;
}): OpenCodeLogScope {
  return createHarnessLogScope<OpenCodeLogEventName | HarnessLogEventName>(args.logger, {
    component: "@xmux/harness-opencode",
    packageName: "@xmux/harness-opencode",
    harnessId: "opencode",
    adapter: "opencode",
    mode: args.mode,
  });
}

export async function logOpenCodeOperation<TValue, TError>(args: {
  readonly logger: OpenCodeLogScope;
  readonly operation: HarnessLogOperation;
  readonly sessionId?: string;
  readonly metadata?: HarnessLogMetadata;
  readonly run: () => Promise<ResultType<TValue, TError>>;
}): Promise<ResultType<TValue, TError>> {
  const startedAt = startHarnessLogTimer();
  const metadata = {
    ...args.metadata,
    operation: args.operation,
    sessionId: args.sessionId,
  } satisfies HarnessLogMetadata;

  args.logger.debug(openCodeLogEvents.operationBegin, metadata);

  try {
    const result = await args.run();

    logHarnessResult({
      logger: args.logger,
      result,
      startedAt,
      metadata,
      successEvent: openCodeLogEvents.operationSuccess,
      failureEvent: openCodeLogEvents.operationFailure,
    });

    return result;
  } catch (cause) {
    logHarnessResult({
      logger: args.logger,
      result: Result.err(cause),
      startedAt,
      metadata,
      successEvent: openCodeLogEvents.operationSuccess,
      failureEvent: openCodeLogEvents.operationFailure,
    });

    throw cause;
  }
}

export { logHarnessResult, startHarnessLogTimer };
export type { HarnessLogger, HarnessLogMetadata, HarnessLogOperation };
