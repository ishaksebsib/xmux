import { Result } from "better-result";
import { HarnessAdapterResumeSessionError } from "../../errors";
import type {
  HarnessAdapterDefinitions,
  ResumeSessionInput,
  ResumeSessionResultFromInput,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createHarnessSessionInfo,
  createWorkingDirectoryPath,
} from "../utils";

export async function handleResumeSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends ResumeSessionInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const cwd = args.input.cwd
      ? yield* Result.await(createWorkingDirectoryPath(args.input.cwd))
      : undefined;
    const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
    const outer = await Result.tryPromise({
      try: async () =>
        runtime.resumeSession({
          sessionId: args.input.sessionId,
          cwd,
          adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
          signal: args.input.signal,
        }),
      catch: (cause) =>
        new HarnessAdapterResumeSessionError({ harnessId: args.input.harnessId, cause }),
    });

    const adapterResult = yield* Result.andThen(outer, (adapterResult) =>
      Result.mapError(
        adapterResult,
        (cause) => new HarnessAdapterResumeSessionError({ harnessId: args.input.harnessId, cause }),
      ),
    );

    const created = await createHarnessSessionInfo({
      harnessId: args.input.harnessId,
      adapterSession: adapterResult,
    });
    const session = yield* Result.mapError(
      created,
      (cause) => new HarnessAdapterResumeSessionError({ harnessId: args.input.harnessId, cause }),
    );

    return Result.ok(session as ResumeSessionResultFromInput<TAdapters, TInput>);
  });
}
