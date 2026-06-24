import { Result } from "better-result";
import { HarnessAdapterAbortError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import type { AbortInput, HarnessAdapterDefinitions } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, invokeAdapter, mapSessionAdapterError } from "../utils";

export async function handleAbort<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends AbortInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  return logHarnessOperation({
    logger: args.logger,
    operation: "abort",
    harnessId: args.input.ref.harnessId,
    sessionId: args.input.ref.sessionId,
    run: () =>
      Result.gen(async function* () {
        const runtime = yield* Result.await(
          args.getRuntime(args.input.ref.harnessId, args.input.signal),
        );
        yield* Result.await(
          invokeAdapter({
            run: () =>
              runtime.abort({
                ref: args.input.ref,
                adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
                  args.input,
                ),
                signal: args.input.signal,
              }),
            mapError: (cause) =>
              mapSessionAdapterError(
                cause,
                (unhandledCause) =>
                  new HarnessAdapterAbortError({
                    harnessId: args.input.ref.harnessId,
                    cause: unhandledCause,
                  }),
              ),
          }),
        );

        return Result.ok();
      }),
  });
}
