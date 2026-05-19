import { Result } from "better-result";
import { HarnessAdapterGetSessionError } from "../../errors";
import type {
  GetSessionInput,
  GetSessionResultFromInput,
  HarnessAdapterDefinitions,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, createHarnessSessionInfo } from "../utils";

export async function handleGetSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetSessionInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const found = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.getSession({
            ref: args.input.ref,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
              args.input,
            ),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterGetSessionError({ harnessId: args.input.ref.harnessId, cause }),
      }),
    );

    if (found.isErr()) {
      return Result.err(
        new HarnessAdapterGetSessionError({
          harnessId: args.input.ref.harnessId,
          cause: found.error,
        }),
      );
    }

    const session = await createHarnessSessionInfo({
      harnessId: args.input.ref.harnessId,
      adapterSession: found.value,
    });
    if (session.isErr()) {
      return Result.err(
        new HarnessAdapterGetSessionError({
          harnessId: args.input.ref.harnessId,
          cause: session.error,
        }),
      );
    }

    return Result.ok(session.value as GetSessionResultFromInput<TAdapters, TInput>);
  });
}
