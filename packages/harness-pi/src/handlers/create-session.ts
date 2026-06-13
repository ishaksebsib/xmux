import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { mergePiCreateOptions } from "../config";
import { PiSessionRequestError } from "../errors";
import type { PiRuntime } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";
import {
  createPiSessionHandle,
  mapLiveSession,
  toModelRef,
  type PiSessionHandlerError,
} from "./utils";

export async function createSession(
  runtime: PiRuntime,
  input: HarnessAdapterCreateSessionInput<PiCreateOptions>,
): Promise<ResultType<HarnessAdapterCreateSessionResult<PiSessionInfo>, PiSessionHandlerError>> {
  const options = mergePiCreateOptions(runtime.config, input.adapterOptions);

  return Result.gen(async function* () {
    const sessionManager = yield* Result.try({
      try: () =>
        SessionManager.create(input.cwd, options.sessionDir, {
          parentSession: options.parentSession,
        }),
      catch: (cause) => new PiSessionRequestError({ operation: "createSession", cause }),
    });

    const created = yield* Result.await(
      Result.tryPromise({
        try: () =>
          createAgentSession({
            cwd: input.cwd,
            agentDir: options.agentDir,
            sessionManager,
            tools: options.tools === undefined ? undefined : [...options.tools],
            excludeTools: options.excludeTools === undefined ? undefined : [...options.excludeTools],
            noTools: options.noTools,
          }),
        catch: (cause) => new PiSessionRequestError({ operation: "createSession", cause }),
      }),
    );

    const handle = createPiSessionHandle({
      session: created.session,
      cwd: input.cwd,
      sessionDir: options.sessionDir,
      agentDir: options.agentDir,
    });
    runtime.sessions.set(handle.sessionId, handle);

    if (input.title) {
      const named = Result.try({
        try: () => created.session.setSessionName(input.title as string),
        catch: (cause) => new PiSessionRequestError({ operation: "setSessionName", cause }),
      });
      if (named.isErr()) {
        runtime.sessions.delete(handle.sessionId);
        Result.try({ try: () => handle.dispose(), catch: (cause) => cause });
        return Result.err(named.error);
      }
    }

    return Result.ok({
      sessionId: handle.sessionId,
      model: toModelRef(handle.session.model),
      adapterData: mapLiveSession(handle).adapterData,
    });
  });
}
