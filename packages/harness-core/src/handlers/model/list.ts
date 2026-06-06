import { Result } from "better-result";
import { HarnessAdapterListModelsError, HarnessAdapterModelUnsupportedError } from "../../errors";
import type {
  HarnessAdapterDefinitions,
  ListModelsInput,
  ListModelsResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, invokeAdapter, requireCapability } from "../utils";

export async function handleListModels<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends ListModelsInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
    const listModels = yield* requireCapability(
      runtime.listModels,
      new HarnessAdapterModelUnsupportedError({
        harnessId: args.input.harnessId,
        operation: "listModels",
      }),
    );
    const models = yield* Result.await(
      invokeAdapter({
        run: () =>
          listModels({
            cwd: args.input.cwd,
            includeUnavailable: args.input.includeUnavailable,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
            signal: args.input.signal,
          }),
        mapError: (cause) =>
          new HarnessAdapterListModelsError({ harnessId: args.input.harnessId, cause }),
      }),
    );

    return Result.ok(models as ListModelsResultFromInput<TAdapters, TInput>);
  });
}
