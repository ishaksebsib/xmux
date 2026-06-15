import type { SessionRef } from "@xmux/harness-core";
import type { DeliveryMode } from "../config";

/**
 * Durable session metadata.
 *
 * Adapter-specific session data should stay in harness-core results unless it is
 * needed for routing or lifecycle decisions.
 */
export interface SessionRecord<
  THarnessId extends string = string,
  TChatId extends string = string,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly origin: ChatThreadRef<TChatId>;
  readonly requester: ActorRef;
  readonly cwd: string;
  readonly title?: string;
  readonly deliveryMode: DeliveryMode;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

/** Fields callers may change after a session has been created. */
export interface SessionRecordPatch {
  readonly title?: string;
  readonly deliveryMode?: DeliveryMode;
  readonly status?: SessionStatus;
  readonly updatedAt: string;
  readonly closedAt?: string;
}

/** Associates a chat thread with the active harness session serving it. */
export interface ThreadBinding<
  THarnessId extends string = string,
  TChatId extends string = string,
> {
  readonly thread: ChatThreadRef<TChatId>;
  readonly sessionRef: SessionRef<THarnessId>;
  readonly createdAt: string;
}

/** Chat thread identity normalized across supported chat adapters. */
export interface ChatThreadRef<TChatId extends string = string> {
  readonly chatId: TChatId;
  readonly threadId: string;
}

/** User that caused work to be created or routed. */
export interface ActorRef {
  readonly userId: string;
  readonly displayName?: string;
}

/** Lifecycle state of a managed harness session. */
export type SessionStatus = "open" | "closed";

export interface CreateSessionRecordInput {
  readonly ref: SessionRecord["ref"];
  readonly origin: ChatThreadRef;
  readonly requester: ActorRef;
  readonly cwd: string;
  readonly deliveryMode: SessionRecord["deliveryMode"];
  readonly title?: string;
  readonly now: string;
}

export function createSessionRecord(input: CreateSessionRecordInput): SessionRecord {
  return {
    ref: input.ref,
    origin: input.origin,
    requester: input.requester,
    cwd: input.cwd,
    ...(input.title === undefined ? {} : { title: input.title }),
    deliveryMode: input.deliveryMode,
    status: "open",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface CreateThreadBindingInput {
  readonly thread: ChatThreadRef;
  readonly sessionRef: ThreadBinding["sessionRef"];
  readonly now: string;
}

export function createThreadBinding(input: CreateThreadBindingInput): ThreadBinding {
  return {
    thread: input.thread,
    sessionRef: input.sessionRef,
    createdAt: input.now,
  };
}

/** Current working directory tracked for one chat thread. */
export interface ThreadWorkspace<TChatId extends string = string> {
  readonly thread: ChatThreadRef<TChatId>;
  readonly cwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateThreadWorkspaceInput {
  readonly thread: ChatThreadRef;
  readonly cwd: string;
  readonly now: string;
}

export function createThreadWorkspace(input: CreateThreadWorkspaceInput): ThreadWorkspace {
  return {
    thread: input.thread,
    cwd: input.cwd,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
