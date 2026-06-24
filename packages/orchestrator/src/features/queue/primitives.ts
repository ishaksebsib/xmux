declare const queueOfferIdBrand: unique symbol;
declare const queueItemIdBrand: unique symbol;
declare const queueIndexBrand: unique symbol;
declare const isoTimestampBrand: unique symbol;
declare const positiveQueueLimitBrand: unique symbol;
declare const positiveTtlMsBrand: unique symbol;

export type QueueOfferId = string & { readonly [queueOfferIdBrand]: true };
export type QueueItemId = string & { readonly [queueItemIdBrand]: true };
export type QueueIndex = number & { readonly [queueIndexBrand]: true };
export type IsoTimestamp = string & { readonly [isoTimestampBrand]: true };
export type PositiveQueueLimit = number & { readonly [positiveQueueLimitBrand]: true };
export type PositiveTtlMs = number & { readonly [positiveTtlMsBrand]: true };

export function makeQueueOfferId(value: string): QueueOfferId {
  return value as QueueOfferId;
}

export function makeQueueItemId(value: string): QueueItemId {
  return value as QueueItemId;
}

export function queueOfferIdFromItemId(value: QueueItemId): QueueOfferId {
  return makeQueueOfferId(value);
}

export function makeQueueIndex(value: number): QueueIndex {
  return value as QueueIndex;
}

export function makeIsoTimestamp(value: string): IsoTimestamp {
  return value as IsoTimestamp;
}

export function makePositiveQueueLimit(value: number): PositiveQueueLimit {
  return value as PositiveQueueLimit;
}

export function makePositiveTtlMs(value: number): PositiveTtlMs {
  return value as PositiveTtlMs;
}
