import { randomBytes } from "node:crypto";
import type {
  ChatActor,
  ChatAdapterObject,
  ChatAttachment,
  ChatConversationRef,
  ChatMessageRef,
} from "@xmux/chat-core";
import type { SessionRef } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import type { Actor } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import { DEFAULT_PROMPT_QUEUE_MAX_ITEMS, DEFAULT_PROMPT_QUEUE_OFFER_TTL_MS } from "./defaults";
import {
  PromptQueueDrainStateConflictError,
  PromptQueueFullError,
  PromptQueueItemNotFoundError,
  PromptQueueOfferNotFoundError,
  PromptQueueOfferStateConflictError,
} from "./errors";
import {
  makeIsoTimestamp,
  makePositiveQueueLimit,
  makePositiveTtlMs,
  makeQueueIndex,
  makeQueueItemId,
  queueOfferIdFromItemId,
  type IsoTimestamp,
  type PositiveQueueLimit,
  type PositiveTtlMs,
  type QueueIndex,
  type QueueItemId,
  type QueueOfferId,
} from "./primitives";

export { DEFAULT_PROMPT_QUEUE_MAX_ITEMS, DEFAULT_PROMPT_QUEUE_OFFER_TTL_MS } from "./defaults";

export type PromptQueueItemSource = "busy_prompt" | "command";
export type PromptQueueOfferState = "offered" | "queued" | "sent";

export type QueueDrainState =
  | { readonly tag: "idle" }
  | {
      readonly tag: "injecting";
      readonly itemId: QueueItemId;
      readonly sessionRef: SessionRef;
      readonly thread: ChatThreadRef;
    };

export type PromptQueueDrainStartOutput =
  | { readonly status: "empty"; readonly state: QueueDrainState }
  | { readonly status: "busy"; readonly state: QueueDrainState }
  | { readonly status: "started"; readonly state: QueueDrainState; readonly item: QueuedPrompt };

export type PromptQueueDrainCompleteOutput =
  | { readonly status: "idle" }
  | { readonly status: "completed"; readonly itemId: QueueItemId; readonly sessionRef: SessionRef };

export interface QueuedPrompt<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly itemId: QueueItemId;
  readonly sessionRef: SessionRef;
  readonly thread: ChatThreadRef<TChatId>;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly text: string;
  readonly attachments: readonly ChatAttachment<TAdapterData, unknown>[];
  readonly actor: ChatActor<TAdapterData>;
  readonly adapterData: TAdapterData;
  readonly requester?: Actor;
  readonly source: PromptQueueItemSource;
  readonly createdAt: IsoTimestamp;
  readonly enqueuedAt?: IsoTimestamp;
}

export interface PromptQueueItemInput<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly sessionRef: SessionRef;
  readonly thread: ChatThreadRef<TChatId>;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessageRef<TChatId>;
  readonly text: string;
  readonly attachments: readonly ChatAttachment<TAdapterData, unknown>[];
  readonly actor: ChatActor<TAdapterData>;
  readonly adapterData: TAdapterData;
  readonly requester?: Actor;
  readonly source: PromptQueueItemSource;
}

export interface PromptQueueOffer<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly offerId: QueueOfferId;
  readonly state: PromptQueueOfferState;
  readonly item: QueuedPrompt<TChatId, TAdapterData>;
  readonly activeSince: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
}

export interface PromptQueuePosition<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly item: QueuedPrompt<TChatId, TAdapterData>;
  readonly index: QueueIndex;
  readonly total: number;
  readonly maxItems: PositiveQueueLimit;
}

export interface PromptQueueRemoveOutput<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> extends PromptQueuePosition<TChatId, TAdapterData> {
  readonly remaining: number;
}

export interface PromptQueueRegistry {
  createOffer<TChatId extends string, TAdapterData extends ChatAdapterObject>(input: {
    readonly item: PromptQueueItemInput<TChatId, TAdapterData>;
    readonly activeSince: string;
    readonly now: string;
  }): PromptQueueOffer<TChatId, TAdapterData>;
  getOffer<
    TChatId extends string = string,
    TAdapterData extends ChatAdapterObject = ChatAdapterObject,
  >(
    offerId: QueueOfferId,
  ): PromptQueueOffer<TChatId, TAdapterData> | undefined;
  deleteOffer(offerId: QueueOfferId): boolean;
  enqueueOffer(
    offerId: QueueOfferId,
    now: string,
  ): ResultType<
    PromptQueuePosition,
    PromptQueueOfferNotFoundError | PromptQueueOfferStateConflictError | PromptQueueFullError
  >;
  enqueue<TChatId extends string, TAdapterData extends ChatAdapterObject>(
    input: PromptQueueItemInput<TChatId, TAdapterData>,
    now: string,
  ): ResultType<PromptQueuePosition<TChatId, TAdapterData>, PromptQueueFullError>;
  removeQueuedOffer(
    offerId: QueueOfferId,
    now: string,
  ): ResultType<
    PromptQueueOffer,
    | PromptQueueOfferNotFoundError
    | PromptQueueOfferStateConflictError
    | PromptQueueItemNotFoundError
  >;
  list(sessionRef: SessionRef): readonly QueuedPrompt[];
  itemAt(sessionRef: SessionRef, index: QueueIndex): PromptQueuePosition | undefined;
  removeByIndex(
    sessionRef: SessionRef,
    index: QueueIndex,
    now: string,
  ): ResultType<PromptQueueRemoveOutput, PromptQueueItemNotFoundError>;
  startDrain(sessionRef: SessionRef, now: string): PromptQueueDrainStartOutput;
  beginInjecting(item: QueuedPrompt): ResultType<QueuedPrompt, PromptQueueDrainStateConflictError>;
  completeDrain(sessionRef: SessionRef): PromptQueueDrainCompleteOutput;
  completeDrainForThread(thread: ChatThreadRef): PromptQueueDrainCompleteOutput;
  failDrainAndRequeue(
    item: QueuedPrompt,
    now: string,
  ): ResultType<PromptQueuePosition, PromptQueueFullError | PromptQueueDrainStateConflictError>;
  requeueFront(
    item: QueuedPrompt,
    now: string,
  ): ResultType<PromptQueuePosition, PromptQueueFullError>;
  suppressSettledRequest(sessionRef: SessionRef, requestId: string): void;
  clearSuppressedSettledRequest(sessionRef: SessionRef, requestId: string): void;
  consumeSuppressedSettledRequest(sessionRef: SessionRef, requestId: string): boolean;
  clearSession(sessionRef: SessionRef): number;
  clearThread(thread: ChatThreadRef): number;
  pruneExpired(now: string): number;
}

export function createPromptQueueRegistry(
  input: {
    readonly maxItems?: number;
    readonly offerTtlMs?: number;
  } = {},
): PromptQueueRegistry {
  const maxItems = makePositiveQueueLimit(input.maxItems ?? DEFAULT_PROMPT_QUEUE_MAX_ITEMS);
  const offerTtlMs = makePositiveTtlMs(input.offerTtlMs ?? DEFAULT_PROMPT_QUEUE_OFFER_TTL_MS);
  const queues = new Map<string, QueuedPrompt[]>();
  const offers = new Map<QueueOfferId, PromptQueueOffer>();
  const drainStates = new Map<string, QueueDrainState>();
  const suppressedSettledRequests = new Map<string, Set<string>>();

  const itemIdIsAvailable = (candidate: QueueItemId) => {
    const offerId = queueOfferIdFromItemId(candidate);
    return (
      !offers.has(offerId) && ![...queues.values()].some((queue) => queueHasItem(queue, candidate))
    );
  };

  return {
    createOffer(args) {
      pruneExpiredOffers(offers, args.now);
      const item = createQueuedPrompt(args.item, args.now, itemIdIsAvailable);
      const now = makeIsoTimestamp(args.now);
      const offer: PromptQueueOffer = {
        offerId: queueOfferIdFromItemId(item.itemId),
        state: "offered",
        item,
        activeSince: makeIsoTimestamp(args.activeSince),
        createdAt: now,
        updatedAt: now,
        expiresAt: expiresAt(args.now, offerTtlMs),
      };
      offers.set(offer.offerId, offer);
      return snapshotOffer(offer) as PromptQueueOffer<
        typeof item.thread.chatId,
        typeof item.adapterData
      >;
    },

    getOffer(offerId) {
      return snapshotMaybeOffer(offers.get(offerId));
    },

    deleteOffer(offerId) {
      return offers.delete(offerId);
    },

    enqueueOffer(offerId, now) {
      pruneExpiredOffers(offers, now);
      const offer = offers.get(offerId);
      if (!offer) return Result.err(new PromptQueueOfferNotFoundError({ offerId }));

      if (offer.state === "queued") {
        const position = positionForItem(
          queues,
          offer.item.sessionRef,
          offer.item.itemId,
          maxItems,
        );
        if (position !== undefined) return Result.ok(position);
        return Result.err(
          new PromptQueueOfferStateConflictError({
            offerId,
            state: offer.state,
            expected: "offered",
          }),
        );
      }

      if (offer.state !== "offered") {
        return Result.err(
          new PromptQueueOfferStateConflictError({
            offerId,
            state: offer.state,
            expected: "offered",
          }),
        );
      }

      const enqueued = enqueueItem(
        queues,
        { ...offer.item, enqueuedAt: makeIsoTimestamp(now) },
        maxItems,
      );
      if (enqueued.isErr()) return enqueued;

      offers.set(offerId, {
        ...offer,
        state: "queued",
        item: enqueued.value.item,
        updatedAt: makeIsoTimestamp(now),
      });
      return Result.ok(enqueued.value);
    },

    enqueue(itemInput, now) {
      pruneExpiredOffers(offers, now);
      const item = createQueuedPrompt(itemInput, now, itemIdIsAvailable);
      return enqueueItem(
        queues,
        { ...item, enqueuedAt: makeIsoTimestamp(now) },
        maxItems,
      ) as ResultType<
        PromptQueuePosition<typeof item.thread.chatId, typeof item.adapterData>,
        PromptQueueFullError
      >;
    },

    removeQueuedOffer(offerId, now) {
      const offer = offers.get(offerId);
      if (!offer) return Result.err(new PromptQueueOfferNotFoundError({ offerId }));

      if (offer.state !== "queued") {
        return Result.err(
          new PromptQueueOfferStateConflictError({
            offerId,
            state: offer.state,
            expected: "queued",
          }),
        );
      }

      const removed = removeItemById(queues, offer.item.sessionRef, offer.item.itemId);
      if (removed === undefined) {
        return Result.err(
          new PromptQueueItemNotFoundError({
            sessionRef: offer.item.sessionRef,
            itemId: offer.item.itemId,
          }),
        );
      }

      const updated = {
        ...offer,
        state: "offered" as const,
        item: removed,
        updatedAt: makeIsoTimestamp(now),
        expiresAt: expiresAt(now, offerTtlMs),
      };
      offers.set(offerId, updated);
      return Result.ok(snapshotOffer(updated));
    },

    list(sessionRef) {
      return queueFor(queues, sessionRef).map(snapshotItem);
    },

    itemAt(sessionRef, index) {
      const queue = queueFor(queues, sessionRef);
      const item = queue[index - 1];
      if (item === undefined) return undefined;

      return {
        item: snapshotItem(item),
        index,
        total: queue.length,
        maxItems,
      };
    },

    removeByIndex(sessionRef, index, now) {
      const queue = queueFor(queues, sessionRef);
      const item = queue[index - 1];
      if (item === undefined) {
        return Result.err(new PromptQueueItemNotFoundError({ sessionRef, index }));
      }

      queue.splice(index - 1, 1);
      deleteQueueIfEmpty(queues, sessionRef, queue);
      const offer = offers.get(queueOfferIdFromItemId(item.itemId));
      if (offer !== undefined && offer.state === "queued") {
        offers.set(offer.offerId, {
          ...offer,
          state: "offered",
          item,
          updatedAt: makeIsoTimestamp(now),
          expiresAt: expiresAt(now, offerTtlMs),
        });
      }

      return Result.ok({
        item: snapshotItem(item),
        index,
        total: queue.length + 1,
        remaining: queue.length,
        maxItems,
      });
    },

    startDrain(sessionRef, now) {
      pruneExpiredOffers(offers, now);
      const state = drainStateFor(drainStates, sessionRef);
      if (state.tag !== "idle") return { status: "busy", state };

      const queue = queueFor(queues, sessionRef);
      const item = queue.shift();
      deleteQueueIfEmpty(queues, sessionRef, queue);
      if (item === undefined) return { status: "empty", state };

      const injecting = injectingState(item);
      drainStates.set(sessionKey(sessionRef), injecting);
      const offer = offers.get(queueOfferIdFromItemId(item.itemId));
      if (offer !== undefined) {
        offers.set(offer.offerId, {
          ...offer,
          state: "sent",
          item,
          updatedAt: makeIsoTimestamp(now),
        });
      }

      return { status: "started", state: injecting, item: snapshotItem(item) };
    },

    beginInjecting(item) {
      const state = drainStateFor(drainStates, item.sessionRef);
      if (state.tag !== "idle") {
        return Result.err(
          new PromptQueueDrainStateConflictError({
            sessionRef: item.sessionRef,
            itemId: item.itemId,
            state: state.tag,
          }),
        );
      }

      drainStates.set(sessionKey(item.sessionRef), injectingState(item));
      return Result.ok(snapshotItem(item));
    },

    completeDrain(sessionRef) {
      const key = sessionKey(sessionRef);
      const state = drainStates.get(key);
      if (state === undefined || state.tag === "idle") return { status: "idle" };

      drainStates.delete(key);
      return { status: "completed", itemId: state.itemId, sessionRef: { ...state.sessionRef } };
    },

    completeDrainForThread(thread) {
      for (const [key, state] of drainStates) {
        if (state.tag !== "injecting") continue;
        if (!sameThreadRef(state.thread, thread)) continue;
        drainStates.delete(key);
        return { status: "completed", itemId: state.itemId, sessionRef: { ...state.sessionRef } };
      }

      return { status: "idle" };
    },

    failDrainAndRequeue(item, now) {
      const state = drainStateFor(drainStates, item.sessionRef);
      if (state.tag !== "injecting" || state.itemId !== item.itemId) {
        return Result.err(
          new PromptQueueDrainStateConflictError({
            sessionRef: item.sessionRef,
            itemId: item.itemId,
            state: state.tag,
          }),
        );
      }

      drainStates.delete(sessionKey(item.sessionRef));
      return requeueFront(queues, offers, item, makeIsoTimestamp(now), maxItems);
    },

    requeueFront(item, now) {
      return requeueFront(queues, offers, item, makeIsoTimestamp(now), maxItems);
    },

    suppressSettledRequest(sessionRef, requestId) {
      const key = sessionKey(sessionRef);
      const requests = suppressedSettledRequests.get(key) ?? new Set<string>();
      requests.add(requestId);
      suppressedSettledRequests.set(key, requests);
    },

    clearSuppressedSettledRequest(sessionRef, requestId) {
      const key = sessionKey(sessionRef);
      const requests = suppressedSettledRequests.get(key);
      if (requests === undefined) return;
      requests.delete(requestId);
      if (requests.size === 0) suppressedSettledRequests.delete(key);
    },

    consumeSuppressedSettledRequest(sessionRef, requestId) {
      const key = sessionKey(sessionRef);
      const requests = suppressedSettledRequests.get(key);
      if (requests === undefined || !requests.has(requestId)) return false;
      requests.delete(requestId);
      if (requests.size === 0) suppressedSettledRequests.delete(key);
      return true;
    },

    clearSession(sessionRef) {
      const key = sessionKey(sessionRef);
      const queueLength = queues.get(key)?.length ?? 0;
      queues.delete(key);
      drainStates.delete(key);
      suppressedSettledRequests.delete(key);

      let deletedOffers = 0;
      for (const [offerId, offer] of offers) {
        if (!sameSessionRef(offer.item.sessionRef, sessionRef)) continue;
        offers.delete(offerId);
        deletedOffers += 1;
      }

      return queueLength + deletedOffers;
    },

    clearThread(thread) {
      let deleted = 0;
      for (const [key, queue] of queues) {
        const remaining = queue.filter((item) => !sameThreadRef(item.thread, thread));
        deleted += queue.length - remaining.length;
        if (remaining.length === 0) queues.delete(key);
        else queues.set(key, remaining);
      }

      for (const [offerId, offer] of offers) {
        if (!sameThreadRef(offer.item.thread, thread)) continue;
        offers.delete(offerId);
        deleted += 1;
      }

      for (const [key, state] of drainStates) {
        if (state.tag !== "injecting" || !sameThreadRef(state.thread, thread)) continue;
        drainStates.delete(key);
        deleted += 1;
      }

      return deleted;
    },

    pruneExpired(now) {
      return pruneExpiredOffers(offers, now);
    },
  };

  function pruneExpiredOffers(map: Map<QueueOfferId, PromptQueueOffer>, now: string): number {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) return 0;

    let deleted = 0;
    for (const [offerId, offer] of map) {
      if (offer.state === "queued") continue;
      const expiresAtMs = Date.parse(offer.expiresAt);
      if (!Number.isFinite(expiresAtMs)) continue;
      if (nowMs <= expiresAtMs) continue;
      map.delete(offerId);
      deleted += 1;
    }

    return deleted;
  }
}

function createQueuedPrompt<TChatId extends string, TAdapterData extends ChatAdapterObject>(
  input: PromptQueueItemInput<TChatId, TAdapterData>,
  now: string,
  isAvailable: (candidate: QueueItemId) => boolean,
): QueuedPrompt<TChatId, TAdapterData> {
  const itemId = createQueueId(isAvailable);

  return {
    itemId,
    sessionRef: { ...input.sessionRef },
    thread: { ...input.thread },
    conversation: { ...input.conversation },
    message: { ...input.message },
    text: input.text,
    attachments: [...input.attachments],
    actor: input.actor,
    adapterData: input.adapterData,
    ...(input.requester === undefined ? {} : { requester: input.requester }),
    source: input.source,
    createdAt: makeIsoTimestamp(now),
  };
}

function enqueueItem(
  queues: Map<string, QueuedPrompt[]>,
  item: QueuedPrompt,
  maxItems: PositiveQueueLimit,
): ResultType<PromptQueuePosition, PromptQueueFullError> {
  const queue = queueFor(queues, item.sessionRef);
  if (queue.length >= maxItems) {
    return Result.err(new PromptQueueFullError({ sessionRef: item.sessionRef, maxItems }));
  }

  queue.push(item);
  queues.set(sessionKey(item.sessionRef), queue);

  return Result.ok({
    item: snapshotItem(item),
    index: makeQueueIndex(queue.length),
    total: queue.length,
    maxItems,
  });
}

function requeueFront(
  queues: Map<string, QueuedPrompt[]>,
  offers: Map<QueueOfferId, PromptQueueOffer>,
  item: QueuedPrompt,
  now: IsoTimestamp,
  maxItems: PositiveQueueLimit,
): ResultType<PromptQueuePosition, PromptQueueFullError> {
  const queue = queueFor(queues, item.sessionRef);
  if (queue.length >= maxItems) {
    return Result.err(new PromptQueueFullError({ sessionRef: item.sessionRef, maxItems }));
  }

  const requeued = { ...item, enqueuedAt: item.enqueuedAt ?? now };
  queue.unshift(requeued);
  queues.set(sessionKey(item.sessionRef), queue);

  const offer = offers.get(queueOfferIdFromItemId(item.itemId));
  if (offer !== undefined) {
    offers.set(offer.offerId, { ...offer, state: "queued", item: requeued, updatedAt: now });
  }

  return Result.ok({
    item: snapshotItem(requeued),
    index: makeQueueIndex(1),
    total: queue.length,
    maxItems,
  });
}

function removeItemById(
  queues: Map<string, QueuedPrompt[]>,
  sessionRef: SessionRef,
  itemId: QueueItemId,
): QueuedPrompt | undefined {
  const queue = queueFor(queues, sessionRef);
  const index = queue.findIndex((item) => item.itemId === itemId);
  if (index < 0) return undefined;

  const [item] = queue.splice(index, 1);
  deleteQueueIfEmpty(queues, sessionRef, queue);
  return item;
}

function positionForItem(
  queues: Map<string, QueuedPrompt[]>,
  sessionRef: SessionRef,
  itemId: QueueItemId,
  maxItems: PositiveQueueLimit,
): PromptQueuePosition | undefined {
  const queue = queueFor(queues, sessionRef);
  const index = queue.findIndex((item) => item.itemId === itemId);
  const item = queue[index];
  if (item === undefined) return undefined;

  return {
    item: snapshotItem(item),
    index: makeQueueIndex(index + 1),
    total: queue.length,
    maxItems,
  };
}

function queueFor(queues: Map<string, QueuedPrompt[]>, sessionRef: SessionRef): QueuedPrompt[] {
  return queues.get(sessionKey(sessionRef)) ?? [];
}

function drainStateFor(
  drainStates: Map<string, QueueDrainState>,
  sessionRef: SessionRef,
): QueueDrainState {
  return drainStates.get(sessionKey(sessionRef)) ?? { tag: "idle" };
}

function injectingState(item: QueuedPrompt): QueueDrainState {
  return {
    tag: "injecting",
    itemId: item.itemId,
    sessionRef: { ...item.sessionRef },
    thread: { ...item.thread },
  };
}

function deleteQueueIfEmpty(
  queues: Map<string, QueuedPrompt[]>,
  sessionRef: SessionRef,
  queue: readonly QueuedPrompt[],
): void {
  if (queue.length === 0) queues.delete(sessionKey(sessionRef));
}

function queueHasItem(queue: readonly QueuedPrompt[], itemId: QueueItemId): boolean {
  return queue.some((item) => item.itemId === itemId);
}

function snapshotMaybeOffer<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
>(offer: PromptQueueOffer | undefined): PromptQueueOffer<TChatId, TAdapterData> | undefined {
  return offer === undefined
    ? undefined
    : (snapshotOffer(offer) as PromptQueueOffer<TChatId, TAdapterData>);
}

function snapshotOffer(offer: PromptQueueOffer): PromptQueueOffer {
  return {
    ...offer,
    item: snapshotItem(offer.item),
  };
}

function snapshotItem(item: QueuedPrompt): QueuedPrompt {
  return {
    ...item,
    sessionRef: { ...item.sessionRef },
    thread: { ...item.thread },
    conversation: { ...item.conversation },
    message: { ...item.message },
    attachments: [...item.attachments],
    ...(item.requester === undefined ? {} : { requester: { ...item.requester } }),
  };
}

function createQueueId(isAvailable: (candidate: QueueItemId) => boolean): QueueItemId {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = makeQueueItemId(randomBytes(6).toString("base64url"));
    if (isAvailable(candidate)) return candidate;
  }

  return makeQueueItemId(randomBytes(9).toString("base64url"));
}

function expiresAt(isoDate: string, ttlMs: PositiveTtlMs): IsoTimestamp {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time)) return makeIsoTimestamp(new Date(Date.now() + ttlMs).toISOString());
  return makeIsoTimestamp(new Date(time + ttlMs).toISOString());
}

function sessionKey(ref: SessionRef): string {
  return JSON.stringify([ref.harnessId, ref.sessionId]);
}

function sameSessionRef(left: SessionRef, right: SessionRef): boolean {
  return left.harnessId === right.harnessId && left.sessionId === right.sessionId;
}

function sameThreadRef(left: ChatThreadRef, right: ChatThreadRef): boolean {
  return left.chatId === right.chatId && left.threadId === right.threadId;
}
