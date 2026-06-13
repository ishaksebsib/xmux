import type {
  HarnessAdapterGetSessionInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";

export async function getSession(
  _runtime: PiRuntime,
  _input: HarnessAdapterGetSessionInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessAdapterSessionInfo<PiSessionInfo>, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "getSession" }));
}
