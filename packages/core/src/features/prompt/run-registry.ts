import { Result } from "better-result";
import type { HarnessPromptEvent, SessionRef } from "@xmux/harness-core";
import { PromptAlreadyRunningError, PromptNoActiveRunError } from "./errors";

export type PromptRunState =
  | "starting"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "aborted";

export interface PendingPromptInteraction {
  readonly requestId: string;
  readonly kind: "permission" | "question";
  readonly prompt: string;
  readonly requestedAt: string;
  readonly ordinal: number;
  readonly status: "pending" | "responding" | "answered" | "rejected";
}

export interface ActivePromptRun {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly startedAt: string;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly state: PromptRunState;
  readonly pendingInteractions: readonly PendingPromptInteraction[];

  recordEvent(event: HarnessPromptEvent): void;
  currentInteraction(): PendingPromptInteraction | undefined;
  markInteractionResponding(requestId: string): void;
  markInteractionPending(requestId: string): void;
  markInteractionResolved(requestId: string, status: "answered" | "rejected"): void;
  markCancelling(): void;
  release(): void;
}

export interface PromptRunRegistry {
  tryStart(input: PromptRunStartInput): Result<ActivePromptRun, PromptAlreadyRunningError>;
  get(sessionRef: SessionRef): ActivePromptRun | undefined;
  cancel(input: PromptRunCancelInput): Result<ActivePromptRun, PromptNoActiveRunError>;
}

export interface PromptRunStartInput {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly now: string;
}

export interface PromptRunCancelInput {
  readonly sessionRef: SessionRef;
  readonly reason?: unknown;
}

/** Creates an in-memory registry that allows one active prompt per session. */
export function createPromptRunRegistry(): PromptRunRegistry {
  const runs = new Map<string, PromptRun>();

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

      const run = new PromptRun({
        sessionRef: input.sessionRef,
        requestId: input.requestId,
        startedAt: input.now,
        onRelease: () => {
          const current = runs.get(key);
          if (current?.requestId === input.requestId) {
            runs.delete(key);
          }
        },
      });

      runs.set(key, run);
      return Result.ok(run);
    },

    get(sessionRef) {
      return runs.get(sessionKey(sessionRef));
    },

    cancel(input) {
      const run = runs.get(sessionKey(input.sessionRef));

      if (!run) {
        return Result.err(new PromptNoActiveRunError({ sessionRef: input.sessionRef }));
      }

      run.markCancelling();
      if (!run.signal.aborted) {
        run.controller.abort(input.reason);
      }

      return Result.ok(run);
    },
  };
}

interface PromptRunInput {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly startedAt: string;
  readonly onRelease: () => void;
}

class PromptRun implements ActivePromptRun {
  readonly sessionRef: SessionRef;
  readonly requestId: string;
  readonly startedAt: string;
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;

  private released = false;
  private nextInteractionOrdinal = 1;
  private runState: PromptRunState = "starting";
  private readonly interactions = new Map<string, PendingPromptInteraction>();
  private readonly onRelease: () => void;

  constructor(input: PromptRunInput) {
    this.sessionRef = { ...input.sessionRef };
    this.requestId = input.requestId;
    this.startedAt = input.startedAt;
    this.onRelease = input.onRelease;
  }

  get state(): PromptRunState {
    return this.runState;
  }

  get pendingInteractions(): readonly PendingPromptInteraction[] {
    return [...this.interactions.values()].sort((left, right) => left.ordinal - right.ordinal);
  }

  recordEvent(event: HarnessPromptEvent): void {
    if (!isSameSessionRef(event.ref, this.sessionRef)) return;

    if (event.type === "run") {
      this.recordRunEvent(event);
      return;
    }

    if (event.type !== "interaction") return;

    if (event.phase === "requested") {
      this.recordInteractionRequested(event);
      return;
    }

    this.markInteractionResolved(event.requestId, event.phase);
  }

  currentInteraction(): PendingPromptInteraction | undefined {
    return this.pendingInteractions.find((interaction) => interaction.status === "pending");
  }

  markInteractionResponding(requestId: string): void {
    const interaction = this.interactions.get(requestId);
    if (!interaction || interaction.status !== "pending") return;

    this.interactions.set(requestId, {
      ...interaction,
      status: "responding",
    });
  }

  markInteractionPending(requestId: string): void {
    const interaction = this.interactions.get(requestId);
    if (!interaction || interaction.status !== "responding") return;

    this.interactions.set(requestId, {
      ...interaction,
      status: "pending",
    });
  }

  markInteractionResolved(requestId: string, _status: "answered" | "rejected"): void {
    this.interactions.delete(requestId);
  }

  markCancelling(): void {
    if (
      this.runState === "completed" ||
      this.runState === "failed" ||
      this.runState === "aborted"
    ) {
      return;
    }

    this.runState = "cancelling";
  }

  release(): void {
    if (this.released) return;

    this.released = true;
    this.onRelease();
  }

  private recordRunEvent(event: Extract<HarnessPromptEvent, { readonly type: "run" }>): void {
    switch (event.phase) {
      case "started":
        this.runState = "running";
        return;
      case "completed":
        this.runState = "completed";
        this.interactions.clear();
        return;
      case "failed":
        this.runState = "failed";
        this.interactions.clear();
        return;
      case "aborted":
        this.runState = "aborted";
        this.interactions.clear();
        return;
    }
  }

  private recordInteractionRequested(
    event: Extract<
      HarnessPromptEvent,
      { readonly type: "interaction"; readonly phase: "requested" }
    >,
  ): void {
    if (this.interactions.has(event.requestId)) return;

    this.interactions.set(event.requestId, {
      requestId: event.requestId,
      kind: event.kind,
      prompt: event.prompt,
      requestedAt: new Date().toISOString(),
      ordinal: this.nextInteractionOrdinal,
      status: "pending",
    });
    this.nextInteractionOrdinal += 1;
  }
}

function isSameSessionRef(left: SessionRef, right: SessionRef): boolean {
  return left.harnessId === right.harnessId && left.sessionId === right.sessionId;
}

function sessionKey(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}
