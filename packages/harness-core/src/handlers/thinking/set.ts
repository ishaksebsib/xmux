import { Result } from "better-result";
import {
  HarnessAdapterSetThinkingError,
  HarnessAdapterThinkingUnsupportedError,
} from "../../errors";
import type { HarnessThinkingTarget } from "../../contracts";
import type {
  HarnessAdapterDefinitions,
  SetThinkingInput,
  SetThinkingResultFromInput,
  ThinkingTargetHarnessId,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, modelTargetHarnessId } from "../utils";

export async function handleSetThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends SetThinkingInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  type THarnessId = ThinkingTargetHarnessId<TInput["target"]> & keyof TAdapters;

  return Result.gen(async function* () {
    const harnessId = modelTargetHarnessId(args.input.target) as unknown as THarnessId;
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const setThinking = runtime.setThinking;
    if (!setThinking) {
      return Result.err(
        new HarnessAdapterThinkingUnsupportedError({
          harnessId: harnessId as string,
          operation: "setThinking",
        }),
      );
    }

    const outer = await Result.tryPromise({
      try: async () =>
        setThinking({
          target: args.input.target as unknown as HarnessThinkingTarget<
            Extract<THarnessId, string>
          >,
          update: args.input.update,
          adapterOptions: adapterOptionsFromInput<TAdapters, THarnessId>(args.input),
          signal: args.input.signal,
        }),
      catch: (cause) =>
        new HarnessAdapterSetThinkingError({ harnessId: harnessId as string, cause }),
    });

    return Result.andThen(outer, (adapterResult) =>
      Result.mapError(
        adapterResult,
        (cause) => new HarnessAdapterSetThinkingError({ harnessId: harnessId as string, cause }),
      ),
    ).map((value) => value as unknown as SetThinkingResultFromInput<TAdapters, TInput>);
  });
}
