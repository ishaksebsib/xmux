import { Result } from "better-result";
import {
  HarnessAdapterSetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import type {
  HarnessAdapterDefinitions,
  SetThinkingInput,
  SetThinkingResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  invokeAdapter,
  mapSessionAdapterError,
  requireCapability,
  targetHarnessId,
} from "../utils";

export async function handleSetThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends SetThinkingInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  const harnessId = targetHarnessId(args.input.target);
  const sessionId =
    args.input.target.type === "session" ? args.input.target.ref.sessionId : undefined;

  return logHarnessOperation({
    logger: args.logger,
    operation: "setThinking",
    harnessId,
    sessionId,
    run: () =>
      Result.gen(async function* () {
        const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
        const setThinking = yield* requireCapability(
          runtime.setThinking,
          new HarnessAdapterThinkingUnsupportedError({
            harnessId,
            operation: "setThinking",
          }),
        );
        const thinking = yield* Result.await(
          invokeAdapter({
            run: () =>
              setThinking({
                target: args.input.target,
                update: args.input.update,
                adapterOptions: adapterOptionsFromInput<TAdapters, typeof harnessId>(args.input),
                signal: args.input.signal,
              }),
            mapError: (cause) =>
              args.input.target.type === "session"
                ? mapSessionAdapterError(
                    cause,
                    (unhandledCause) =>
                      new HarnessAdapterSetThinkingError({ harnessId, cause: unhandledCause }),
                  )
                : new HarnessAdapterSetThinkingError({ harnessId, cause }),
          }),
        );

        return Result.ok(thinking as SetThinkingResultFromInput<TAdapters, TInput>);
      }),
  });
}
