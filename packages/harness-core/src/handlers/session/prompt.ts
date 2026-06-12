import { Result } from "better-result";
import { HarnessAdapterPromptError } from "../../errors";
import type { HarnessLogScope } from "../../logger";
import { logHarnessOperation } from "../../logger-utils";
import { supervisePromptStream } from "../../runtime/prompt-stream";
import type { HarnessAdapterDefinitions, PromptInput, PromptResultFromInput } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createWorkingDirectoryPath,
  invokeAdapter,
  normalizePromptContent,
} from "../utils";

export async function handlePrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends PromptInput<TAdapters>,
>(args: {
  readonly input: TInput;
  readonly getRuntime: HarnessRuntimeGetter<TAdapters>;
  readonly logger?: HarnessLogScope;
}) {
  return logHarnessOperation({
    logger: args.logger,
    operation: "prompt",
    harnessId: args.input.ref.harnessId,
    sessionId: args.input.ref.sessionId,
    run: () => Result.gen(async function* () {
      const cwd = yield* Result.await(createWorkingDirectoryPath(args.input.cwd));
      const runtime = yield* Result.await(
        args.getRuntime(args.input.ref.harnessId, args.input.signal),
      );
      const adapterResult = yield* Result.await(
        invokeAdapter({
          run: () =>
            runtime.prompt({
              ref: args.input.ref,
              cwd,
              content: normalizePromptContent(args.input.content),
              model: args.input.model,
              thinking: args.input.thinking,
              adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
                args.input,
              ),
              signal: args.input.signal,
            }),
          mapError: (cause) =>
            new HarnessAdapterPromptError({ harnessId: args.input.ref.harnessId, cause }),
        }),
      );

      return Result.ok(
        supervisePromptStream({
          ref: args.input.ref,
          events: adapterResult,
          signal: args.input.signal,
        }) as PromptResultFromInput<TAdapters, TInput>,
      );
    }),
  });
}
