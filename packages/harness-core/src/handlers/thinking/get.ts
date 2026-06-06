import { Result } from "better-result";
import {
  HarnessAdapterGetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
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
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const harnessId = targetHarnessId(args.input.target);
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
  });
}
