import type { Result } from "better-result";
import type { BusPublishError, BusStartError, BusSubscribeError } from "./errors";
import type { CorrelationId, MessageId, MessageSource } from "./ids";

export type MessageKind = "command" | "event";

/** Transport-agnostic MessageBus, used by routers and adapters. */
export type MessageBus<Catalog extends MessageCatalog> = {
	start(): Promise<Result<void, BusStartError>>;
	stop(options?: StopOptions): Promise<Result<void, never>>;
	publish<TType extends MessageType<Catalog>>(
		input: PublishInput<Catalog, TType>,
	): Promise<Result<PublishReceipt, BusPublishError>>;
	subscribe<TType extends MessageType<Catalog>>(
		input: SubscribeInput<Catalog, TType>,
	): Promise<Result<Subscription, BusSubscribeError>>;
};

/** Declares a message contract once so publishers and subscribers stay type-safe from the same source. */
export type MessageDefinition<TKind extends MessageKind = MessageKind, TData = unknown> = {
	readonly kind: TKind;
	readonly data?: TData;
};

export type MessageCatalog = Record<string, MessageDefinition>;

/** Runtime shape for a catalog value, where payload types stay in TypeScript and runtime code only provides metadata. */
export type MessageCatalogDefinition<Catalog extends MessageCatalog> = {
	readonly [TType in keyof Catalog]: Omit<Catalog[TType], "data">;
};

export type MessageType<Catalog extends MessageCatalog> = Extract<keyof Catalog, string>;

/** Looks up the payload type for a specific message type in a catalog. */
export type MessageData<Catalog extends MessageCatalog, TType extends MessageType<Catalog>> =
	Catalog[TType] extends MessageDefinition<MessageKind, infer TData> ? TData : never;

/** Canonical message envelope delivered by the bus after ids, timing, and trace metadata have been attached. */
export type BusMessage<TType extends string = string, TData = unknown> = {
	readonly id: MessageId;
	readonly type: TType;
	readonly kind: MessageKind;
	readonly source: MessageSource;
	readonly subject?: string;
	readonly time: string;
	readonly correlationId: CorrelationId;
	readonly causationId?: MessageId;
	readonly traceparent?: string;
	readonly data: TData;
};

/** Fully typed delivered message for one catalog entry, including its exact payload and kind. */
export type MessageOf<
	Catalog extends MessageCatalog,
	TType extends MessageType<Catalog>,
> = BusMessage<TType, MessageData<Catalog, TType>> & {
	readonly kind: Catalog[TType]["kind"];
};

/** Union of every bus message described by a catalog. */
export type AnyMessage<Catalog extends MessageCatalog> = {
	readonly [TType in MessageType<Catalog>]: MessageOf<Catalog, TType>;
}[MessageType<Catalog>];

/** Input accepted by `publish()`, before the bus adds generated envelope fields such as ids and timestamps. */
export type PublishInput<Catalog extends MessageCatalog, TType extends MessageType<Catalog>> = {
	readonly type: TType;
	readonly data: MessageData<Catalog, TType>;
	readonly source: MessageSource;
	readonly subject?: string;
	readonly correlationId?: CorrelationId;
	readonly causationId?: MessageId;
	readonly traceparent?: string;
};

export type PublishReceipt = {
	readonly messageId: MessageId;
	readonly correlationId: CorrelationId;
};

export type ConsumeContext = {
	readonly deliveryAttempt: number;
	readonly signal: AbortSignal;
};

/** Subscriber callback signature with both the typed message and delivery metadata. */
export type MessageHandler<TMessage extends BusMessage> = (
	message: TMessage,
	context: ConsumeContext,
) => Promise<void> | void;

/** Configuration passed to `subscribe()`, including handler ownership, retry policy, and concurrency. */
export type SubscribeInput<Catalog extends MessageCatalog, TType extends MessageType<Catalog>> = {
	readonly type: TType;
	readonly name: string;
	readonly handler: MessageHandler<MessageOf<Catalog, TType>>;
	readonly consumerGroup?: string;
	readonly concurrency?: number;
	readonly maxRetries?: number;
};

export type Subscription = {
	readonly id: string;
	readonly name: string;
	unsubscribe(): void;
};

export type StopOptions = {
	readonly drainTimeoutMs?: number;
};

/** Explicit lifecycle state machine for bus implementations. */
export type BusLifecycleState =
	| { readonly status: "created" }
	| { readonly status: "starting" }
	| { readonly status: "running" }
	| { readonly status: "draining"; readonly startedAt: number }
	| { readonly status: "stopped" };

/** Delivery failure details reported to dead-letter handling after retries are exhausted. */
export type DeadLetter<Catalog extends MessageCatalog> = {
	readonly message: AnyMessage<Catalog>;
	readonly error: unknown;
	readonly attempts: number;
	readonly subscription: {
		readonly id: string;
		readonly name: string;
		readonly consumerGroup?: string;
	};
};
