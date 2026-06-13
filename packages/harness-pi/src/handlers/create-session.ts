import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";

export async function createSession(
  _runtime: PiRuntime,
  _input: HarnessAdapterCreateSessionInput<PiCreateOptions>,
): Promise<ResultType<HarnessAdapterCreateSessionResult<PiSessionInfo>, PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "createSession" }));
}
