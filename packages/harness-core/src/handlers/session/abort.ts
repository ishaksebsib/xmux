import { Result } from "better-result";
import { HarnessAdapterAbortError } from "../../errors";
import type { AbortInput, HarnessAdapterDefinitions } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput } from "../utils";

export async function handleAbort<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends AbortInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const aborted = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.abort({
            ref: args.input.ref,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
              args.input,
            ),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterAbortError({ harnessId: args.input.ref.harnessId, cause }),
      }),
    );

    return aborted.isErr()
      ? Result.err(
          new HarnessAdapterAbortError({
            harnessId: args.input.ref.harnessId,
            cause: aborted.error,
          }),
        )
      : Result.ok();
  });
}
