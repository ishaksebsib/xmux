import { Result } from "better-result";
import { HarnessAdapterModelUnsupportedError, HarnessAdapterSetModelError } from "../../errors";
import type { HarnessModelTarget } from "../../contracts";
import type {
  HarnessAdapterDefinitions,
  ModelTargetHarnessId,
  SetModelInput,
  SetModelResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, modelTargetHarnessId } from "../utils";

export async function handleSetModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends SetModelInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  type THarnessId = ModelTargetHarnessId<TInput["target"]> & keyof TAdapters;

  return Result.gen(async function* () {
    const harnessId = modelTargetHarnessId(args.input.target) as unknown as THarnessId;
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const setModel = runtime.setModel;
    if (!setModel) {
      return Result.err(
        new HarnessAdapterModelUnsupportedError({
          harnessId: harnessId as string,
          operation: "setModel",
        }),
      );
    }

    const selected = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          setModel({
            target: args.input.target as unknown as HarnessModelTarget<Extract<THarnessId, string>>,
            update: args.input.update,
            adapterOptions: adapterOptionsFromInput<TAdapters, THarnessId>(args.input),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterSetModelError({ harnessId: harnessId as string, cause }),
      }),
    );

    return selected.isErr()
      ? Result.err(
          new HarnessAdapterSetModelError({
            harnessId: harnessId as string,
            cause: selected.error,
          }),
        )
      : Result.ok(selected.value as unknown as SetModelResultFromInput<TAdapters, TInput>);
  });
}
