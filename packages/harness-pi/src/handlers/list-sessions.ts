import type {
  HarnessAdapterListSessionsInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiNotImplementedError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";

export async function listSessions(
  _runtime: PiRuntime,
  _input: HarnessAdapterListSessionsInput<PiCreateOptions>,
): Promise<ResultType<readonly HarnessAdapterSessionInfo<PiSessionInfo>[], PiNotImplementedError>> {
  return Result.err(new PiNotImplementedError({ operation: "listSessions" }));
}
