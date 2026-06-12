import { Result } from "better-result";
import { HarnessAdapterGetModelError, HarnessAdapterModelUnsupportedError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
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
    operation: "getModel",
    harnessId,
    sessionId,
    run: () =>
      Result.gen(async function* () {
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
      }),
  });
}
