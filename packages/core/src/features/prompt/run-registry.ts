import { Result, type Result as BetterResult } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import { PromptAlreadyRunningError } from "./errors";

export interface PromptRunLease {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  release(): void;
}

export interface PromptRunRegistry {
  tryStart(input: PromptRunStartInput): BetterResult<PromptRunLease, PromptAlreadyRunningError>;
}

export interface PromptRunStartInput {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly now: string;
}

/** Creates an in-memory registry that allows one active prompt per session. */
export function createPromptRunRegistry(): PromptRunRegistry {
  const runs = new Map<string, ActivePromptRun>();

  return {
    tryStart(input) {
      const key = sessionKey(input.sessionRef);
      const active = runs.get(key);

      if (active) {
        return Result.err(
          new PromptAlreadyRunningError({
            sessionRef: input.sessionRef,
            requestId: input.requestId,
            activeRequestId: active.requestId,
            activeSince: active.startedAt,
          }),
        );
      }

      runs.set(key, { requestId: input.requestId, startedAt: input.now });

      let released = false;
      return Result.ok({
        sessionRef: { ...input.sessionRef },
        requestId: input.requestId,
        release() {
          if (released) {
            return;
          }

          released = true;
          const current = runs.get(key);
          if (current?.requestId === input.requestId) {
            runs.delete(key);
          }
        },
      });
    },
  };
}

interface ActivePromptRun {
  readonly requestId: string;
  readonly startedAt: string;
}

function sessionKey(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}
