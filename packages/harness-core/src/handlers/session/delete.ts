import { Result } from "better-result";
import { HarnessAdapterDeleteSessionError } from "../../errors";
import type { DeleteSessionInput, HarnessAdapterDefinitions } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput } from "../utils";

export async function handleDeleteSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends DeleteSessionInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const deleted = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.deleteSession({
            ref: args.input.ref,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
              args.input,
            ),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterDeleteSessionError({ harnessId: args.input.ref.harnessId, cause }),
      }),
    );

    return deleted.isErr()
      ? Result.err(
          new HarnessAdapterDeleteSessionError({
            harnessId: args.input.ref.harnessId,
            cause: deleted.error,
          }),
        )
      : Result.ok();
  });
}
