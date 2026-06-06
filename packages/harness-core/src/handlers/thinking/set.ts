import { Result } from "better-result";
import {
  HarnessAdapterSetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
import type {
  HarnessAdapterDefinitions,
  SetThinkingInput,
  SetThinkingResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  invokeAdapter,
  requireCapability,
  targetHarnessId,
} from "../utils";

export async function handleSetThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends SetThinkingInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const harnessId = targetHarnessId(args.input.target);
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
        mapError: (cause) => new HarnessAdapterSetThinkingError({ harnessId, cause }),
      }),
    );

    return Result.ok(thinking as SetThinkingResultFromInput<TAdapters, TInput>);
  });
}
