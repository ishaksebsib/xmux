import type {
  HarnessAdapterGetModelInput,
  HarnessAdapterListModelsInput,
  HarnessAdapterSetModelInput,
  HarnessModelInfo,
  HarnessSelectedModel,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiModelInfo } from "../types";

export async function listModels(
  _runtime: PiRuntime,
  _input: HarnessAdapterListModelsInput<PiCreateOptions>,
): Promise<ResultType<readonly HarnessModelInfo<"pi", PiModelInfo>[], PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "listModels" }));
}

export async function getModel(
  _runtime: PiRuntime,
  _input: HarnessAdapterGetModelInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"pi">, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "getModel" }));
}

export async function setModel(
  _runtime: PiRuntime,
  _input: HarnessAdapterSetModelInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessSelectedModel<"pi">, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "setModel" }));
}
