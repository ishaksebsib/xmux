import { Result } from "better-result";
import { HarnessAdapterPromptError } from "../../errors";
import type { HarnessPromptEvent } from "../../events";
import type { HarnessAdapterDefinitions, PromptInput, PromptResultFromInput } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createWorkingDirectoryPath,
  normalizePromptContent,
} from "../utils";

async function* catchPromptStreamFailures<THarnessId extends string>(args: {
  readonly ref: { readonly harnessId: THarnessId; readonly sessionId: string };
  readonly events: AsyncIterable<HarnessPromptEvent<THarnessId>>;
}): AsyncIterable<HarnessPromptEvent<THarnessId>> {
  try {
    yield* args.events;
  } catch (error) {
    yield {
      type: "run",
      phase: "failed",
      ref: args.ref,
      reason: "error",
      error,
    };
  }
}

export async function handlePrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends PromptInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(createWorkingDirectoryPath(args.input.cwd));
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const prompted = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          runtime.prompt({
            ref: args.input.ref,
            cwd,
            content: normalizePromptContent(args.input.content),
            adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
              args.input,
            ),
            signal: args.input.signal,
          }),
        catch: (cause) =>
          new HarnessAdapterPromptError({ harnessId: args.input.ref.harnessId, cause }),
      }),
    );

    if (prompted.isErr()) {
      return Result.err(
        new HarnessAdapterPromptError({
          harnessId: args.input.ref.harnessId,
          cause: prompted.error,
        }),
      );
    }

    return Result.ok(
      catchPromptStreamFailures({
        ref: args.input.ref,
        events: prompted.value,
      }) as PromptResultFromInput<TAdapters, TInput>,
    );
  });
}
