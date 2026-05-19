import { Result } from "better-result";
import { HarnessAdapterListSessionsError } from "../../errors";
import type { HarnessAdapterObject, HarnessSessionInfo } from "../../contracts";
import type {
  AdapterSessionFor,
  HarnessAdapterDefinitions,
  ListSessionsInput,
  ListSessionsResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { adapterOptionsFromInput, createHarnessSessionInfo } from "../utils";

export async function handleListSessions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends ListSessionsInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
    const listed = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.listSessions({
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterListSessionsError({ harnessId: args.input.harnessId, cause }),
      }),
    );

    if (listed.isErr()) {
      return Result.err(
        new HarnessAdapterListSessionsError({
          harnessId: args.input.harnessId,
          cause: listed.error,
        }),
      );
    }

    const sessions = [] as HarnessSessionInfo<
      TInput["harnessId"],
      AdapterSessionFor<TAdapters, TInput["harnessId"]>
    >[];
    for (const adapterSession of listed.value) {
      const session = await createHarnessSessionInfo({
        harnessId: args.input.harnessId,
        adapterSession: adapterSession as typeof adapterSession & {
          readonly adapterData: HarnessAdapterObject;
        },
      });
      if (session.isErr()) {
        return Result.err(
          new HarnessAdapterListSessionsError({
            harnessId: args.input.harnessId,
            cause: session.error,
          }),
        );
      }
      sessions.push(session.value as (typeof sessions)[number]);
    }

    return Result.ok(sessions as unknown as ListSessionsResultFromInput<TAdapters, TInput>);
  });
}
