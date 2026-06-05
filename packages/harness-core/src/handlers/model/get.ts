import { Result } from "better-result";
import { HarnessAdapterGetModelError, HarnessAdapterModelUnsupportedError } from "../../errors";
import type { HarnessModelTarget } from "../../contracts";
import type {
  GetModelInput,
  GetModelResultFromInput,
  HarnessAdapterDefinitions,
  ModelTargetHarnessId,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, modelTargetHarnessId } from "../utils";

export async function handleGetModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetModelInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  type THarnessId = ModelTargetHarnessId<TInput["target"]> & keyof TAdapters;

  return Result.gen(async function* () {
    const harnessId = modelTargetHarnessId(args.input.target) as unknown as THarnessId;
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const getModel = runtime.getModel;
    if (!getModel) {
      return Result.err(
        new HarnessAdapterModelUnsupportedError({
          harnessId: harnessId as string,
          operation: "getModel",
        }),
      );
    }

    const outer = await Result.tryPromise({
      try: async () =>
        getModel({
          target: args.input.target as unknown as HarnessModelTarget<Extract<THarnessId, string>>,
          adapterOptions: adapterOptionsFromInput<TAdapters, THarnessId>(args.input),
          signal: args.input.signal,
        }),
      catch: (cause) => new HarnessAdapterGetModelError({ harnessId: harnessId as string, cause }),
    });

    return Result.andThen(outer, (adapterResult) =>
      Result.mapError(
        adapterResult,
        (cause) => new HarnessAdapterGetModelError({ harnessId: harnessId as string, cause }),
      ),
    ).map((value) => value as unknown as GetModelResultFromInput<TAdapters, TInput>);
  });
}
