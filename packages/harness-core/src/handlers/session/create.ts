import { Result } from "better-result";
import type {
  CreatedSessionFromInput,
  CreateSessionInput,
  HarnessAdapterDefinitions,
} from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createAdapterSession,
  createWorkingDirectoryPath,
} from "../utils";

export async function handleCreateSession<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends CreateSessionInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly now: () => Date;
}) {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(createWorkingDirectoryPath(args.input.cwd));
    const runtime = yield* Result.await(args.getRuntime(args.input.harnessId, args.input.signal));
    const created = yield* Result.await(
      createAdapterSession({
        runtime,
        harnessId: args.input.harnessId,
        input: {
          cwd,
          title: args.input.title,
          model: args.input.model,
          adapterOptions: adapterOptionsFromInput<TAdapters, TInput["harnessId"]>(args.input),
          signal: args.input.signal,
        },
      }),
    );

    const session = {
      ref: {
        harnessId: args.input.harnessId,
        sessionId: created.sessionId,
      },
      cwd,
      title: args.input.title,
      model: created.model ?? args.input.model,
      createdAt: args.now().toISOString(),
      adapterData: created.adapterData,
    } as CreatedSessionFromInput<TAdapters, TInput>;

    return Result.ok(session);
  });
}
