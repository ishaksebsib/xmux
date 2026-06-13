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

export const piLogEvents = {
  openBegin: "xmux.pi.open.begin",
  openSuccess: "xmux.pi.open.success",
  openFailure: "xmux.pi.open.failure",
  closeBegin: "xmux.pi.close.begin",
  closeSuccess: "xmux.pi.close.success",
  closeFailure: "xmux.pi.close.failure",
  operationBegin: "xmux.pi.operation.begin",
  operationSuccess: "xmux.pi.operation.success",
  operationFailure: "xmux.pi.operation.failure",
} as const satisfies Record<string, `xmux.pi.${string}`>;

export type PiLogEventName = (typeof piLogEvents)[keyof typeof piLogEvents];
export type PiLogScope = HarnessLogScope<PiLogEventName | HarnessLogEventName>;

export function createPiLogScope(args: { readonly logger?: HarnessLogger }): PiLogScope {
  return createHarnessLogScope<PiLogEventName | HarnessLogEventName>(args.logger, {
    component: "@xmux/harness-pi",
    packageName: "@xmux/harness-pi",
    harnessId: "pi",
    adapter: "pi",
    mode: "sdk",
  });
}

export async function logPiOperation<TValue, TError>(args: {
  readonly logger: PiLogScope;
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
    mode: "sdk",
  } satisfies HarnessLogMetadata;

  args.logger.debug(piLogEvents.operationBegin, metadata);

  try {
    const result = await args.run();

    logHarnessResult({
      logger: args.logger,
      result,
      startedAt,
      metadata,
      successEvent: piLogEvents.operationSuccess,
      failureEvent: piLogEvents.operationFailure,
    });

    return result;
  } catch (cause) {
    logHarnessResult({
      logger: args.logger,
      result: Result.err(cause),
      startedAt,
      metadata,
      successEvent: piLogEvents.operationSuccess,
      failureEvent: piLogEvents.operationFailure,
    });

    throw cause;
  }
}

export { logHarnessResult, startHarnessLogTimer };
export type { HarnessLogger, HarnessLogMetadata, HarnessLogOperation };
