import type { HarnessAdapterAbortInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";

export async function abortSession(
  _runtime: PiRuntime,
  _input: HarnessAdapterAbortInput<"pi", PiCreateOptions>,
): Promise<ResultType<void, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "abort" }));
}
