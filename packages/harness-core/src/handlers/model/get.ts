import { Result } from "better-result";
import { HarnessAdapterGetModelError, HarnessAdapterModelUnsupportedError } from "../../errors";
import type {
  GetModelInput,
  GetModelResultFromInput,
  HarnessAdapterDefinitions,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  invokeAdapter,
  requireCapability,
  targetHarnessId,
} from "../utils";

export async function handleGetModel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetModelInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const harnessId = targetHarnessId(args.input.target);
    const runtime = yield* Result.await(args.getRuntime(harnessId, args.input.signal));
    const getModel = yield* requireCapability(
      runtime.getModel,
      new HarnessAdapterModelUnsupportedError({
        harnessId,
        operation: "getModel",
      }),
    );
    const model = yield* Result.await(
      invokeAdapter({
        run: () =>
          getModel({
            target: args.input.target,
            adapterOptions: adapterOptionsFromInput<TAdapters, typeof harnessId>(args.input),
            signal: args.input.signal,
          }),
        mapError: (cause) => new HarnessAdapterGetModelError({ harnessId, cause }),
      }),
    );

    return Result.ok(model as GetModelResultFromInput<TAdapters, TInput>);
  });
}
