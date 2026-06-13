import { unlink } from "node:fs/promises";
import type { HarnessAdapterDeleteSessionInput } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { PiSessionRequestError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions } from "../types";
import {
  fileExists,
  resolvePiSession,
  validateSessionJsonlPath,
  type PiSessionHandlerError,
  type ResolvedPiSession,
} from "./utils";

function deleteResolvedPiSession(args: {
  readonly runtime: PiRuntime;
  readonly resolved: ResolvedPiSession;
}): Promise<ResultType<void, PiSessionHandlerError>> {
  return Result.gen(async function* () {
    const live = args.runtime.sessions.get(args.resolved.sessionId);
    if (live) {
      args.runtime.sessions.delete(args.resolved.sessionId);
      yield* Result.try({
        try: () => live.dispose(),
        catch: (cause) => new PiSessionRequestError({ operation: "deleteSession", cause }),
      });
    }

    if (!args.resolved.sessionFile) return Result.ok();
    const sessionPath = yield* validateSessionJsonlPath({
      operation: "deleteSession",
      sessionPath: args.resolved.sessionFile,
    });
    const exists = yield* Result.await(
      fileExists({ operation: "deleteSession", filePath: sessionPath }),
    );
    if (!exists) return Result.ok();

    yield* Result.await(
      Result.tryPromise({
        try: () => unlink(sessionPath),
        catch: (cause) => new PiSessionRequestError({ operation: "deleteSession", cause }),
      }),
    );

    return Result.ok();
  });
}

export async function deleteSession(
  runtime: PiRuntime,
  input: HarnessAdapterDeleteSessionInput<"pi", PiCreateOptions>,
): Promise<ResultType<void, PiSessionHandlerError>> {
  return Result.gen(async function* () {
    const resolved = yield* Result.await(
      resolvePiSession({
        runtime,
        operation: "deleteSession",
        sessionId: input.ref.sessionId,
        adapterOptions: input.adapterOptions,
      }),
    );
    yield* Result.await(deleteResolvedPiSession({ runtime, resolved }));
    return Result.ok();
  });
}
