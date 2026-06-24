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
import {
  PromptQueueFullError,
  PromptQueueItemNotFoundError,
  PromptQueueOfferNotFoundError,
  PromptQueueOfferStateConflictError,
} from "./errors";

export const DEFAULT_PROMPT_QUEUE_MAX_ITEMS = 10;
export const DEFAULT_PROMPT_QUEUE_OFFER_TTL_MS = 15 * 60 * 1000;

export type PromptQueueItemSource = "busy_prompt" | "command";
export type PromptQueueOfferState = "offered" | "queued" | "sent";

export interface QueuedPrompt<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly itemId: string;
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
  readonly createdAt: string;
  readonly enqueuedAt?: string;
}

export interface PromptQueueItemInput<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly sessionRef: SessionRef;
  readonly thread: ChatThreadRef<TChatId>;
  readonly conversation: ChatConversationRef<TChatId>;
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
  readonly offerId: string;
  readonly state: PromptQueueOfferState;
  readonly item: QueuedPrompt<TChatId, TAdapterData>;
  readonly activeSince: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export interface PromptQueuePosition<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly item: QueuedPrompt<TChatId, TAdapterData>;
  readonly index: number;
  readonly total: number;
  readonly maxItems: number;
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
    offerId: string,
  ): PromptQueueOffer<TChatId, TAdapterData> | undefined;
  deleteOffer(offerId: string): boolean;
  enqueueOffer(
    offerId: string,
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
    offerId: string,
    now: string,
  ): ResultType<
    PromptQueueOffer,
    | PromptQueueOfferNotFoundError
    | PromptQueueOfferStateConflictError
    | PromptQueueItemNotFoundError
  >;
  list(sessionRef: SessionRef): readonly QueuedPrompt[];
  removeByIndex(
    sessionRef: SessionRef,
    index: number,
    now: string,
  ): ResultType<PromptQueueRemoveOutput, PromptQueueItemNotFoundError>;
  dequeueNext(sessionRef: SessionRef, now: string): QueuedPrompt | undefined;
  requeueFront(
    item: QueuedPrompt,
    now: string,
  ): ResultType<PromptQueuePosition, PromptQueueFullError>;
  suppressNextDrain(sessionRef: SessionRef): void;
  clearSuppressNextDrain(sessionRef: SessionRef): void;
  consumeSuppressNextDrain(sessionRef: SessionRef): boolean;
  pruneExpired(now: string): number;
}

export function createPromptQueueRegistry(
  input: {
    readonly maxItems?: number;
    readonly offerTtlMs?: number;
  } = {},
): PromptQueueRegistry {
  const maxItems = input.maxItems ?? DEFAULT_PROMPT_QUEUE_MAX_ITEMS;
  const offerTtlMs = input.offerTtlMs ?? DEFAULT_PROMPT_QUEUE_OFFER_TTL_MS;
  const queues = new Map<string, QueuedPrompt[]>();
  const offers = new Map<string, PromptQueueOffer>();
  const suppressedDrains = new Set<string>();

  const itemIdIsAvailable = (candidate: string) =>
    !offers.has(candidate) && ![...queues.values()].some((queue) => queueHasItem(queue, candidate));

  return {
    createOffer(args) {
      pruneExpiredOffers(offers, args.now, offerTtlMs);
      const item = createQueuedPrompt(args.item, args.now, itemIdIsAvailable);
      const offer: PromptQueueOffer = {
        offerId: item.itemId,
        state: "offered",
        item,
        activeSince: args.activeSince,
        createdAt: args.now,
        updatedAt: args.now,
        expiresAt: addMilliseconds(args.now, offerTtlMs),
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
      pruneExpiredOffers(offers, now, offerTtlMs);
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

      const enqueued = enqueueItem(queues, { ...offer.item, enqueuedAt: now }, maxItems);
      if (enqueued.isErr()) return enqueued;

      offers.set(offerId, { ...offer, state: "queued", item: enqueued.value.item, updatedAt: now });
      return Result.ok(enqueued.value);
    },

    enqueue(itemInput, now) {
      pruneExpiredOffers(offers, now, offerTtlMs);
      const item = createQueuedPrompt(itemInput, now, itemIdIsAvailable);
      return enqueueItem(queues, { ...item, enqueuedAt: now }, maxItems) as ResultType<
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

      const updated = { ...offer, state: "offered" as const, item: removed, updatedAt: now };
      offers.set(offerId, updated);
      return Result.ok(snapshotOffer(updated));
    },

    list(sessionRef) {
      return queueFor(queues, sessionRef).map(snapshotItem);
    },

    removeByIndex(sessionRef, index, now) {
      const queue = queueFor(queues, sessionRef);
      const item = queue[index - 1];
      if (item === undefined) {
        return Result.err(new PromptQueueItemNotFoundError({ sessionRef, index }));
      }

      queue.splice(index - 1, 1);
      deleteQueueIfEmpty(queues, sessionRef, queue);
      const offer = offers.get(item.itemId);
      if (offer !== undefined && offer.state === "queued") {
        offers.set(item.itemId, { ...offer, state: "offered", item, updatedAt: now });
      }

      return Result.ok({
        item: snapshotItem(item),
        index,
        total: queue.length + 1,
        remaining: queue.length,
        maxItems,
      });
    },

    dequeueNext(sessionRef, now) {
      pruneExpiredOffers(offers, now, offerTtlMs);
      const queue = queueFor(queues, sessionRef);
      const item = queue.shift();
      deleteQueueIfEmpty(queues, sessionRef, queue);
      if (item === undefined) return undefined;

      const offer = offers.get(item.itemId);
      if (offer !== undefined) {
        offers.set(item.itemId, { ...offer, state: "sent", item, updatedAt: now });
      }

      return snapshotItem(item);
    },

    requeueFront(item, now) {
      const queue = queueFor(queues, item.sessionRef);
      if (queue.length >= maxItems) {
        return Result.err(new PromptQueueFullError({ sessionRef: item.sessionRef, maxItems }));
      }

      const requeued = { ...item, enqueuedAt: item.enqueuedAt ?? now };
      queue.unshift(requeued);
      queues.set(sessionKey(item.sessionRef), queue);
      const offer = offers.get(item.itemId);
      if (offer !== undefined) {
        offers.set(item.itemId, { ...offer, state: "queued", item: requeued, updatedAt: now });
      }

      const position = positionForItem(queues, item.sessionRef, item.itemId, maxItems);
      return position === undefined
        ? Result.err(new PromptQueueFullError({ sessionRef: item.sessionRef, maxItems }))
        : Result.ok(position);
    },

    suppressNextDrain(sessionRef) {
      suppressedDrains.add(sessionKey(sessionRef));
    },

    clearSuppressNextDrain(sessionRef) {
      suppressedDrains.delete(sessionKey(sessionRef));
    },

    consumeSuppressNextDrain(sessionRef) {
      const key = sessionKey(sessionRef);
      const suppressed = suppressedDrains.has(key);
      if (suppressed) suppressedDrains.delete(key);
      return suppressed;
    },

    pruneExpired(now) {
      return pruneExpiredOffers(offers, now, offerTtlMs);
    },
  };
}

function createQueuedPrompt<TChatId extends string, TAdapterData extends ChatAdapterObject>(
  input: PromptQueueItemInput<TChatId, TAdapterData>,
  now: string,
  isAvailable: (candidate: string) => boolean,
): QueuedPrompt<TChatId, TAdapterData> {
  const itemId = createQueueId(isAvailable);

  return {
    itemId,
    sessionRef: { ...input.sessionRef },
    thread: { ...input.thread },
    conversation: { ...input.conversation },
    message: {
      chatId: input.conversation.chatId,
      conversationId: input.conversation.conversationId,
      messageId: `queue-${itemId}`,
    },
    text: input.text,
    attachments: [...input.attachments],
    actor: input.actor,
    adapterData: input.adapterData,
    ...(input.requester === undefined ? {} : { requester: input.requester }),
    source: input.source,
    createdAt: now,
  };
}

function enqueueItem(
  queues: Map<string, QueuedPrompt[]>,
  item: QueuedPrompt,
  maxItems: number,
): ResultType<PromptQueuePosition, PromptQueueFullError> {
  const queue = queueFor(queues, item.sessionRef);
  if (queue.length >= maxItems) {
    return Result.err(new PromptQueueFullError({ sessionRef: item.sessionRef, maxItems }));
  }

  queue.push(item);
  queues.set(sessionKey(item.sessionRef), queue);

  return Result.ok({
    item: snapshotItem(item),
    index: queue.length,
    total: queue.length,
    maxItems,
  });
}

function removeItemById(
  queues: Map<string, QueuedPrompt[]>,
  sessionRef: SessionRef,
  itemId: string,
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
  itemId: string,
  maxItems: number,
): PromptQueuePosition | undefined {
  const queue = queueFor(queues, sessionRef);
  const index = queue.findIndex((item) => item.itemId === itemId);
  const item = queue[index];
  if (item === undefined) return undefined;

  return {
    item: snapshotItem(item),
    index: index + 1,
    total: queue.length,
    maxItems,
  };
}

function queueFor(queues: Map<string, QueuedPrompt[]>, sessionRef: SessionRef): QueuedPrompt[] {
  return queues.get(sessionKey(sessionRef)) ?? [];
}

function deleteQueueIfEmpty(
  queues: Map<string, QueuedPrompt[]>,
  sessionRef: SessionRef,
  queue: readonly QueuedPrompt[],
): void {
  if (queue.length === 0) queues.delete(sessionKey(sessionRef));
}

function queueHasItem(queue: readonly QueuedPrompt[], itemId: string): boolean {
  return queue.some((item) => item.itemId === itemId);
}

function pruneExpiredOffers(
  offers: Map<string, PromptQueueOffer>,
  now: string,
  ttlMs: number,
): number {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return 0;

  let deleted = 0;
  for (const [offerId, offer] of offers) {
    if (offer.state === "queued") continue;
    const updatedAtMs = Date.parse(offer.updatedAt);
    if (!Number.isFinite(updatedAtMs)) continue;
    if (nowMs - updatedAtMs <= ttlMs) continue;
    offers.delete(offerId);
    deleted += 1;
  }

  return deleted;
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

function createQueueId(isAvailable: (candidate: string) => boolean): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomBytes(6).toString("base64url");
    if (isAvailable(candidate)) return candidate;
  }

  return randomBytes(9).toString("base64url");
}

function addMilliseconds(isoDate: string, milliseconds: number): string {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time)) return new Date(Date.now() + milliseconds).toISOString();
  return new Date(time + milliseconds).toISOString();
}

function sessionKey(ref: SessionRef): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}
