import { Result } from "better-result";
import { HarnessAdapterModelUnsupportedError, HarnessAdapterSetModelError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
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
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  const harnessId = targetHarnessId(args.input.target);
  const sessionId =
    args.input.target.type === "session" ? args.input.target.ref.sessionId : undefined;

  return logHarnessOperation({
    logger: args.logger,
    operation: "setModel",
    harnessId,
    sessionId,
    run: () =>
      Result.gen(async function* () {
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
      }),
  });
}
