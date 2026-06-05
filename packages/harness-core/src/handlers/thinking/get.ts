import { Result } from "better-result";
import {
  HarnessAdapterGetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
import type { HarnessThinkingTarget } from "../../contracts";
import type {
  GetThinkingInput,
  GetThinkingResultFromInput,
  HarnessAdapterDefinitions,
  ThinkingTargetHarnessId,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, modelTargetHarnessId } from "../utils";

export async function handleGetThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetThinkingInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  type THarnessId = ThinkingTargetHarnessId<TInput["target"]> & keyof TAdapters;

  return Result.gen(async function* () {
    const harnessId = modelTargetHarnessId(args.input.target) as unknown as THarnessId;
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const getThinking = runtime.getThinking;
    if (!getThinking) {
      return Result.err(
        new HarnessAdapterThinkingUnsupportedError({
          harnessId: harnessId as string,
          operation: "getThinking",
        }),
      );
    }

    const outer = await Result.tryPromise({
      try: async () =>
        getThinking({
          target: args.input.target as unknown as HarnessThinkingTarget<
            Extract<THarnessId, string>
          >,
          adapterOptions: adapterOptionsFromInput<TAdapters, THarnessId>(args.input),
          signal: args.input.signal,
        }),
      catch: (cause) =>
        new HarnessAdapterGetThinkingError({ harnessId: harnessId as string, cause }),
    });

    return Result.andThen(outer, (adapterResult) =>
      Result.mapError(
        adapterResult,
        (cause) => new HarnessAdapterGetThinkingError({ harnessId: harnessId as string, cause }),
      ),
    ).map((value) => value as unknown as GetThinkingResultFromInput<TAdapters, TInput>);
  });
}
