import type {
  HarnessAdapterListSessionsInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { mergePiCreateOptions } from "../config";
import { PiSessionRequestError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";
import { listPiSessions, mergeListedSessions } from "./utils";

export async function listSessions(
  runtime: PiRuntime,
  input: HarnessAdapterListSessionsInput<PiCreateOptions>,
): Promise<ResultType<readonly HarnessAdapterSessionInfo<PiSessionInfo>[], PiSessionRequestError>> {
  const options = mergePiCreateOptions(runtime.config, input.adapterOptions);

  return Result.gen(async function* () {
    const sessions = yield* Result.await(
      listPiSessions({ operation: "listSessions", cwd: input.cwd, sessionDir: options.sessionDir }),
    );

    return Result.ok(mergeListedSessions({ runtime, sessions, cwd: input.cwd }));
  });
}
