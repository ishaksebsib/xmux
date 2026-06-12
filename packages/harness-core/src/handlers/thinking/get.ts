import { Result } from "better-result";
import {
  HarnessAdapterGetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import type {
  GetThinkingInput,
  GetThinkingResultFromInput,
  HarnessAdapterDefinitions,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  invokeAdapter,
  requireCapability,
  targetHarnessId,
} from "../utils";

export async function handleGetThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetThinkingInput<TAdapters>,
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
    operation: "getThinking",
    harnessId,
    sessionId,
    run: () => Result.gen(async function* () {
      const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
      const getThinking = yield* requireCapability(
        runtime.getThinking,
        new HarnessAdapterThinkingUnsupportedError({
          harnessId,
          operation: "getThinking",
        }),
      );
      const thinking = yield* Result.await(
        invokeAdapter({
          run: () =>
            getThinking({
              target: args.input.target,
              adapterOptions: adapterOptionsFromInput<TAdapters, typeof harnessId>(args.input),
              signal: args.input.signal,
            }),
          mapError: (cause) => new HarnessAdapterGetThinkingError({ harnessId, cause }),
        }),
      );

      return Result.ok(thinking as GetThinkingResultFromInput<TAdapters, TInput>);
    }),
  });
}
