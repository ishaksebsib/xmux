import { Result } from "better-result";
import { HarnessAdapterListSessionsError } from "../../errors";
import type { HarnessAdapterObject, HarnessSessionInfo } from "../../contracts";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import type { AdapterSessionFor, HarnessAdapterDefinitions, ListSessionsInput } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, createHarnessSessionInfo, invokeAdapter } from "../utils";

export async function handleListSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends ListSessionsInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  return logHarnessOperation({
    logger: args.logger,
    operation: "listSessions",
    harnessId: args.input.harnessId,
    run: () => Result.gen(async function* () {
      const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
      const adapterSessions = yield* Result.await(
        invokeAdapter({
          run: () =>
            runtime.listSessions({
              cwd: args.input.cwd,
              adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
              signal: args.input.signal,
            }),
          mapError: (cause) =>
            new HarnessAdapterListSessionsError({ harnessId: args.input.harnessId, cause }),
        }),
      );

      const sessions = [] as HarnessSessionInfo<
        Extract<TInput["harnessId"], string>,
        AdapterSessionFor<TAdapters, TInput["harnessId"]>
      >[];
      for (const adapterSession of adapterSessions) {
        const created = await createHarnessSessionInfo({
          harnessId: args.input.harnessId,
          adapterSession: adapterSession as typeof adapterSession & {
            readonly adapterData: HarnessAdapterObject;
          },
        });
        const session = yield* Result.mapError(
          created,
          (cause) => new HarnessAdapterListSessionsError({ harnessId: args.input.harnessId, cause }),
        );
        sessions.push(session as (typeof sessions)[number]);
      }

      return Result.ok(sessions);
    }),
  });
}
