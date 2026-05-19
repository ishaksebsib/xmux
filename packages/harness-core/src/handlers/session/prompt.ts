import { Result } from "better-result";
import { HarnessAdapterPromptError } from "../../errors";
import type { HarnessAdapterDefinitions, PromptInput } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import { createStubCause } from "../utils";

export async function handlePrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends PromptInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    yield* Result.await(args.getRuntime(args.input.ref.harnessId, args.input.signal));
    return Result.err(
      new HarnessAdapterPromptError({
        harnessId: args.input.ref.harnessId,
        cause: createStubCause("prompt"),
      }),
    );
  });
}
