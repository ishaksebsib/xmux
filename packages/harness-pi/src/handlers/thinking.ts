import type {
  HarnessAdapterGetThinkingInput,
  HarnessAdapterSetThinkingInput,
  HarnessSelectedThinking,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";

export async function getThinking(
  _runtime: PiRuntime,
  _input: HarnessAdapterGetThinkingInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"pi">, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "getThinking" }));
}

export async function setThinking(
  _runtime: PiRuntime,
  _input: HarnessAdapterSetThinkingInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedThinking<"pi">, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "setThinking" }));
}
