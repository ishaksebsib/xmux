import { Result } from "better-result";
import { HarnessAdapterGetSessionError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import type {
  GetSessionInput,
  GetSessionResultFromInput,
  HarnessAdapterDefinitions,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, createHarnessSessionInfo, invokeAdapter } from "../utils";

export async function handleGetSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends GetSessionInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  return logHarnessOperation({
    logger: args.logger,
    operation: "getSession",
    harnessId: args.input.ref.harnessId,
    sessionId: args.input.ref.sessionId,
    run: () => Result.gen(async function* () {
      const runtime = yield* Result.await(
        args.getRuntime(args.input.ref.harnessId, args.input.signal),
      );
      const adapterSession = yield* Result.await(
        invokeAdapter({
          run: () =>
            runtime.getSession({
              ref: args.input.ref,
              adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
                args.input,
              ),
              signal: args.input.signal,
            }),
          mapError: (cause) =>
            new HarnessAdapterGetSessionError({ harnessId: args.input.ref.harnessId, cause }),
        }),
      );

      const created = await createHarnessSessionInfo({
        harnessId: args.input.ref.harnessId,
        adapterSession,
      });
      const session = yield* Result.mapError(
        created,
        (cause) => new HarnessAdapterGetSessionError({ harnessId: args.input.ref.harnessId, cause }),
      );

      return Result.ok(session as GetSessionResultFromInput<TAdapters, TInput>);
    }),
  });
}
