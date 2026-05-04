import { randomUUID } from "node:crypto";
import type { Brand } from "../utils";

export type MessageId = Brand<string, "MessageId">;

export type CorrelationId = Brand<string, "CorrelationId">;

export type MessageSource = Brand<string, "MessageSource">;

export function createMessageId(value: string = randomUUID()): MessageId {
	return brandNonEmpty(value, "MessageId");
}

export function createCorrelationId(value: string = randomUUID()): CorrelationId {
	return brandNonEmpty(value, "CorrelationId");
}

export function createMessageSource(value: string): MessageSource {
	return brandNonEmpty(value, "MessageSource");
}

function brandNonEmpty<TBrand extends string>(value: string, brand: TBrand): Brand<string, TBrand> {
	if (value.trim().length === 0) throw new Error(`${brand} must be a non-empty string`);
	return value as Brand<string, TBrand>;
}
