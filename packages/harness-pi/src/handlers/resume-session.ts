import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  HarnessAdapterResumeSessionInput,
  HarnessAdapterSessionInfo,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import { mergePiCreateOptions } from "../config";
import { PiSessionRequestError, PiSessionResponseError } from "../errors";
import type { PiRuntime, PiSessionHandle } from "../runtime";
import type { PiCreateOptions, PiSessionInfo } from "../types";
import {
  createPiSessionHandle,
  mapLiveSession,
  resolvePiSession,
  type PiSessionHandlerError,
  type ResolvedPiSession,
} from "./utils";

function openResolvedPiSession(args: {
  readonly runtime: PiRuntime;
  readonly resolved: ResolvedPiSession;
  readonly adapterOptions?: PiCreateOptions;
}): Promise<ResultType<PiSessionHandle, PiSessionHandlerError>> {
  if (args.resolved.handle) return Promise.resolve(Result.ok(args.resolved.handle));

  const options = mergePiCreateOptions(args.runtime.config, args.adapterOptions);

  return Result.gen(async function* () {
    if (!args.resolved.sessionFile) {
      return Result.err(
        new PiSessionResponseError({
          operation: "resumeSession",
          reason: "resolved session does not have a session file",
          detail: args.resolved.sessionId,
        }),
      );
    }

    const sessionManager = yield* Result.try({
      try: () => SessionManager.open(args.resolved.sessionFile as string, options.sessionDir, args.resolved.cwd),
      catch: (cause) => new PiSessionRequestError({ operation: "resumeSession", cause }),
    });

    if (sessionManager.getSessionId() !== args.resolved.sessionId) {
      return Result.err(
        new PiSessionResponseError({
          operation: "resumeSession",
          reason: "resolved session id changed before open",
          detail: args.resolved.sessionId,
        }),
      );
    }

    const created = yield* Result.await(
      Result.tryPromise({
        try: () =>
          createAgentSession({
            cwd: sessionManager.getCwd(),
            agentDir: options.agentDir,
            sessionManager,
            tools: options.tools === undefined ? undefined : [...options.tools],
            excludeTools: options.excludeTools === undefined ? undefined : [...options.excludeTools],
            noTools: options.noTools,
          }),
        catch: (cause) => new PiSessionRequestError({ operation: "resumeSession", cause }),
      }),
    );

    const handle = createPiSessionHandle({
      session: created.session,
      cwd: sessionManager.getCwd(),
      sessionDir: options.sessionDir ?? sessionManager.getSessionDir(),
      agentDir: options.agentDir,
    });
    args.runtime.sessions.set(handle.sessionId, handle);

    return Result.ok(handle);
  });
}

export async function resumeSession(
  runtime: PiRuntime,
  input: HarnessAdapterResumeSessionInput<PiCreateOptions>,
): Promise<ResultType<HarnessAdapterSessionInfo<PiSessionInfo>, PiSessionHandlerError>> {
  return Result.gen(async function* () {
    const resolved = yield* Result.await(
      resolvePiSession({
        runtime,
        operation: "resumeSession",
        sessionId: input.sessionId,
        cwd: input.cwd,
        adapterOptions: input.adapterOptions,
      }),
    );
    const handle = yield* Result.await(
      openResolvedPiSession({ runtime, resolved, adapterOptions: input.adapterOptions }),
    );
    return Result.ok(mapLiveSession(handle));
  });
}
