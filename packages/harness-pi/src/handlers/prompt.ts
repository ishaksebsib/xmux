import type { HarnessAdapterPromptInput, HarnessAdapterPromptResult } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";

export async function prompt(
  _runtime: PiRuntime,
  _input: HarnessAdapterPromptInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessAdapterPromptResult<"pi">, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "prompt" }));
}
