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
    const resumed = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.resumeSession({
            sessionId: args.input.sessionId,
            cwd,
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterResumeSessionError({ harnessId: args.input.harnessId, cause }),
      }),
    );

    if (resumed.isErr()) {
      return Result.err(
        new HarnessAdapterResumeSessionError({
          harnessId: args.input.harnessId,
          cause: resumed.error,
        }),
      );
    }

    const session = await createHarnessSessionInfo({
      harnessId: args.input.harnessId,
      adapterSession: resumed.value,
    });
    if (session.isErr()) {
      return Result.err(
        new HarnessAdapterResumeSessionError({
          harnessId: args.input.harnessId,
          cause: session.error,
        }),
      );
    }

    return Result.ok(session.value as ResumeSessionResultFromInput<TAdapters, TInput>);
  });
}
