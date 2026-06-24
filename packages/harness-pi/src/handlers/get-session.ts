import type { HarnessAdapterGetSessionInput, HarnessAdapterSessionInfo } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";
import {
  mapLiveSession,
  mapPiSessionHandlerError,
  mapPiSessionInfo,
  resolvePiSession,
  type PiPublicSessionHandlerError,
} from "./utils";

export async function getSession(
  runtime: PiRuntime,
  input: HarnessAdapterGetSessionInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessAdapterSessionInfo<PiSessionInfo>, PiPublicSessionHandlerError>> {
  return Result.gen(async function* () {
    const resolved = yield* Result.mapError(
      await resolvePiSession({
        runtime,
        operation: "getSession",
        sessionId: input.ref.sessionId,
        adapterOptions: input.adapterOptions,
      }),
      (error) => mapPiSessionHandlerError({ error, ref: input.ref, operation: "getSession" }),
    );
    if (resolved.handle) return Result.ok(mapLiveSession(resolved.handle));
    if (resolved.info) return Result.ok(mapPiSessionInfo(resolved.info));

    return Result.ok({
      sessionId: resolved.sessionId,
      cwd: resolved.cwd,
      adapterData: {
        sessionFile: resolved.sessionFile,
        sessionDir: resolved.sessionDir,
      },
    });
  });
}
