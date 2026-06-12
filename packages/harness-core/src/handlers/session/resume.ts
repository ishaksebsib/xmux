import { Result } from "better-result";
import { HarnessAdapterResumeSessionError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
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
  invokeAdapter,
} from "../utils";

export async function handleResumeSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends ResumeSessionInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  return logHarnessOperation({
    logger: args.logger,
    operation: "resumeSession",
    harnessId: args.input.harnessId,
    sessionId: args.input.sessionId,
    run: () => Result.gen(async function* () {
      const cwd = args.input.cwd
        ? yield* Result.await(createWorkingDirectoryPath(args.input.cwd))
        : undefined;
      const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
      const adapterResult = yield* Result.await(
        invokeAdapter({
          run: () =>
            runtime.resumeSession({
              sessionId: args.input.sessionId,
              cwd,
              adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
              signal: args.input.signal,
            }),
          mapError: (cause) =>
            new HarnessAdapterResumeSessionError({ harnessId: args.input.harnessId, cause }),
        }),
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
    }),
  });
}
