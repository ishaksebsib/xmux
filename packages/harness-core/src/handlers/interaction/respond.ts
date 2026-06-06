import { Result } from "better-result";
import {
  HarnessAdapterInteractionUnsupportedError,
  HarnessAdapterRespondInteractionError,
} from "../../errors";
import type {
  HarnessAdapterDefinitions,
  RespondInteractionInput,
  RespondInteractionResult,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createWorkingDirectoryPath,
  invokeAdapter,
  requireCapability,
} from "../utils";

export async function handleRespondInteraction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends RespondInteractionInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const respondInteraction = yield* requireCapability(
      runtime.respondInteraction,
      new HarnessAdapterInteractionUnsupportedError({
        harnessId: args.input.ref.harnessId,
        operation: "respondInteraction",
      }),
    );

    const cwd = args.input.cwd
      ? yield* Result.await(createWorkingDirectoryPath(args.input.cwd))
      : undefined;

    yield* Result.await(
      invokeAdapter({
        run: () =>
          respondInteraction({
            ref: args.input.ref,
            cwd,
            response: args.input.response,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
              args.input,
            ),
            signal: args.input.signal,
          }),
        mapError: (cause) =>
          new HarnessAdapterRespondInteractionError({
            harnessId: args.input.ref.harnessId,
            cause,
          }),
      }),
    );

    return Result.ok(undefined as RespondInteractionResult);
  });
}
