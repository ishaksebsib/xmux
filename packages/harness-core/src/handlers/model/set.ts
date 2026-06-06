import { Result } from "better-result";
import { HarnessAdapterModelUnsupportedError, HarnessAdapterSetModelError } from "../../errors";
import type {
  HarnessAdapterDefinitions,
  SetModelInput,
  SetModelResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  invokeAdapter,
  requireCapability,
  targetHarnessId,
} from "../utils";

export async function handleSetModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends SetModelInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const harnessId = targetHarnessId(args.input.target);
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const setModel = yield* requireCapability(
      runtime.setModel,
      new HarnessAdapterModelUnsupportedError({
        harnessId,
        operation: "setModel",
      }),
    );
    const model = yield* Result.await(
      invokeAdapter({
        run: () =>
          setModel({
            target: args.input.target,
            update: args.input.update,
            adapterOptions: adapterOptionsFromInput<TAdapters, typeof harnessId>(args.input),
            signal: args.input.signal,
          }),
        mapError: (cause) => new HarnessAdapterSetModelError({ harnessId, cause }),
      }),
    );

    return Result.ok(model as SetModelResultFromInput<TAdapters, TInput>);
  });
}
