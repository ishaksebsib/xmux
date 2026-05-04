import { randomUUID } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import {
  BusNotRunningError,
  InvalidSubscriptionOptionsError,
  UnknownMessageTypeError,
  type BusPublishError,
  type BusSubscribeError,
} from "../errors";
import { createCorrelationId, createMessageId } from "../ids";
import type {
  AnyMessage,
  BusLifecycleState,
  DeadLetter,
  MessageBus,
  MessageCatalog,
  MessageCatalogDefinition,
  MessageData,
  MessageHandler,
  MessageOf,
  MessageType,
  PublishInput,
  PublishReceipt,
  StopOptions,
  SubscribeInput,
  Subscription,
} from "../contracts";
import { createQueue, type Queue } from "./queue";

export type CreateMemoryBusInput<Catalog extends MessageCatalog> = {
  readonly catalog: MessageCatalogDefinition<Catalog>;
  readonly onDeadLetter?: (deadLetter: DeadLetter<Catalog>) => Promise<void> | void;
  readonly onDeadLetterError?: (input: {
    readonly deadLetter: DeadLetter<Catalog>;
    readonly error: unknown;
  }) => Promise<void> | void;
};

type SubscriptionRecord<Catalog extends MessageCatalog> = {
  readonly id: string;
  readonly type: MessageType<Catalog>;
  readonly name: string;
  readonly consumerGroup?: string;
  readonly concurrency: number;
  readonly maxRetries: number;
  readonly handler: MessageHandler<AnyMessage<Catalog>>;
  readonly queue: Queue<AnyMessage<Catalog>>;
  readonly controllers: Set<AbortController>;
  active: number;
  closed: boolean;
};

type MessageTypeSubscriptions<Catalog extends MessageCatalog> = {
  readonly direct: SubscriptionRecord<Catalog>[];
  readonly groups: Map<string, SubscriptionRecord<Catalog>[]>;
};

/** Provides local async delivery. */
export function createMemoryBus<Catalog extends MessageCatalog>(
  input: CreateMemoryBusInput<Catalog>,
): MessageBus<Catalog> {
  return new MemoryMessageBus(input);
}

class MemoryMessageBus<Catalog extends MessageCatalog> implements MessageBus<Catalog> {
  private state: BusLifecycleState = { status: "created" };
  private readonly subscriptions = new Map<string, SubscriptionRecord<Catalog>>();
  private readonly subscriptionsByType = new Map<
    MessageType<Catalog>,
    MessageTypeSubscriptions<Catalog>
  >();
  private readonly groupCursors = new Map<MessageType<Catalog>, Map<string, number>>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly input: CreateMemoryBusInput<Catalog>) {}

  async start() {
    if (this.state.status === "running") return Result.ok();
    if (this.state.status === "stopped" || this.state.status === "draining") {
      return Result.err(new BusNotRunningError({ operation: "start", status: this.state.status }));
    }

    this.state = { status: "running" };
    return Result.ok();
  }

  async stop(options: StopOptions = {}) {
    if (this.state.status === "stopped") return Result.ok();
    if (this.state.status === "created") {
      this.state = { status: "stopped" };
      return Result.ok();
    }

    this.state = { status: "draining", startedAt: Date.now() };

    const drain = this.waitForDrain();
    if (options.drainTimeoutMs === undefined) {
      await drain;
    } else {
      const drained = await Promise.race([
        drain.then(() => true),
        this.abortAfter(options.drainTimeoutMs).then(() => false),
      ]);

      if (!drained) this.closeSubscriptions();
    }

    this.closeSubscriptions();
    this.groupCursors.clear();
    this.state = { status: "stopped" };
    return Result.ok();
  }

  async publish<TType extends MessageType<Catalog>>(
    input: PublishInput<Catalog, TType>,
  ): Promise<ResultType<PublishReceipt, BusPublishError>> {
    if (this.state.status !== "running") {
      return Result.err(
        new BusNotRunningError({ operation: "publish", status: this.state.status }),
      );
    }

    const definition = this.input.catalog[input.type];
    if (!definition) return Result.err(new UnknownMessageTypeError({ type: input.type }));

    const message = this.createMessage({ input, definition, data: input.data });
    this.dispatch(message);

    return Result.ok({ messageId: message.id, correlationId: message.correlationId });
  }

  async subscribe<TType extends MessageType<Catalog>>(
    input: SubscribeInput<Catalog, TType>,
  ): Promise<ResultType<Subscription, BusSubscribeError>> {
    if (this.state.status === "stopped" || this.state.status === "draining") {
      return Result.err(
        new BusNotRunningError({ operation: "subscribe", status: this.state.status }),
      );
    }

    if (!this.input.catalog[input.type])
      return Result.err(new UnknownMessageTypeError({ type: input.type }));

    const concurrency = input.concurrency ?? 1;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      return Result.err(
        new InvalidSubscriptionOptionsError({
          option: "concurrency",
          value: concurrency,
          expectation: "an integer greater than 0",
        }),
      );
    }

    const maxRetries = input.maxRetries ?? 0;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
      return Result.err(
        new InvalidSubscriptionOptionsError({
          option: "maxRetries",
          value: maxRetries,
          expectation: "a non-negative integer",
        }),
      );
    }

    const id = randomUUID();
    const record: SubscriptionRecord<Catalog> = {
      id,
      type: input.type,
      name: input.name,
      consumerGroup: input.consumerGroup,
      concurrency,
      maxRetries,
      handler: input.handler as MessageHandler<AnyMessage<Catalog>>,
      queue: createQueue(),
      controllers: new Set(),
      active: 0,
      closed: false,
    };

    this.subscriptions.set(id, record);
    this.indexSubscription(record);

    return Result.ok({
      id,
      name: input.name,
      unsubscribe: () => {
        this.closeSubscription(record);
        this.deleteSubscription(record);
      },
    });
  }

  private createMessage<TType extends MessageType<Catalog>>(input: {
    readonly input: PublishInput<Catalog, TType>;
    readonly definition: Omit<Catalog[TType], "data">;
    readonly data: MessageData<Catalog, TType>;
  }): MessageOf<Catalog, TType> {
    const message = {
      id: createMessageId(),
      type: input.input.type,
      kind: input.definition.kind,
      source: input.input.source,
      subject: input.input.subject,
      time: new Date().toISOString(),
      correlationId: input.input.correlationId ?? createCorrelationId(),
      causationId: input.input.causationId,
      traceparent: input.input.traceparent,
      data: input.data,
    };

    return message as MessageOf<Catalog, TType>;
  }

  private dispatch(message: AnyMessage<Catalog>) {
    const subscriptions = this.subscriptionsByType.get(message.type);
    if (!subscriptions) return;

    for (const subscription of subscriptions.direct) {
      this.enqueueDelivery(subscription, message);
    }

    const cursors = this.getGroupCursors(message.type);
    for (const [groupName, groupSubscriptions] of subscriptions.groups) {
      if (groupSubscriptions.length === 0) continue;

      const cursor = cursors.get(groupName) ?? 0;
      const subscription = groupSubscriptions[cursor % groupSubscriptions.length];
      if (!subscription) continue;

      cursors.set(groupName, cursor + 1);

      this.enqueueDelivery(subscription, message);
    }
  }

  private enqueueDelivery(subscription: SubscriptionRecord<Catalog>, message: AnyMessage<Catalog>) {
    subscription.queue.enqueue(message);
    if (subscription.active < subscription.concurrency) {
      this.drainSubscription(subscription);
    }
  }

  private drainSubscription(subscription: SubscriptionRecord<Catalog>) {
    while (!subscription.closed && subscription.active < subscription.concurrency) {
      const message = subscription.queue.dequeue();
      if (!message) return;

      subscription.active += 1;
      const controller = new AbortController();
      subscription.controllers.add(controller);

      const task = this.deliver({ subscription, message, controller }).finally(() => {
        subscription.controllers.delete(controller);
        subscription.active -= 1;
        this.inFlight.delete(task);
        this.drainSubscription(subscription);
      });

      this.inFlight.add(task);
    }
  }

  private async deliver(input: {
    readonly subscription: SubscriptionRecord<Catalog>;
    readonly message: AnyMessage<Catalog>;
    readonly controller: AbortController;
  }) {
    let lastError: unknown;

    // TODO: support configurable retry backoff before durable transports rely on this policy.
    for (let attempt = 1; attempt <= input.subscription.maxRetries + 1; attempt += 1) {
      if (input.controller.signal.aborted) return;

      try {
        await input.subscription.handler(input.message, {
          deliveryAttempt: attempt,
          signal: input.controller.signal,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const deadLetter = {
      message: input.message,
      error: lastError,
      attempts: input.subscription.maxRetries + 1,
      subscription: {
        id: input.subscription.id,
        name: input.subscription.name,
        consumerGroup: input.subscription.consumerGroup,
      },
    } satisfies DeadLetter<Catalog>;

    try {
      await this.input.onDeadLetter?.(deadLetter);
    } catch (error) {
      try {
        await this.input.onDeadLetterError?.({ deadLetter, error });
      } catch {
        // Contain dead-letter reporting failures so delivery tasks never reject from diagnostics.
      }
    }
  }

  private async abortAfter(timeoutMs: number) {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    for (const subscription of this.subscriptions.values()) {
      for (const controller of subscription.controllers) {
        controller.abort();
      }
    }
  }

  private async waitForDrain() {
    while (this.hasPendingWork()) {
      if (this.inFlight.size === 0) return;
      await Promise.allSettled(this.inFlight);
    }
  }

  private hasPendingWork() {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.active > 0 || subscription.queue.size > 0) return true;
    }

    return false;
  }

  private closeSubscriptions() {
    for (const subscription of this.subscriptions.values()) {
      this.closeSubscription(subscription);
    }

    this.subscriptions.clear();
    this.subscriptionsByType.clear();
    this.groupCursors.clear();
  }

  private closeSubscription(subscription: SubscriptionRecord<Catalog>) {
    subscription.closed = true;
    subscription.queue.clear();

    for (const controller of subscription.controllers) {
      controller.abort();
    }
  }

  private indexSubscription(subscription: SubscriptionRecord<Catalog>) {
    const indexed = this.getIndexedSubscriptions(subscription.type);
    if (!subscription.consumerGroup) {
      indexed.direct.push(subscription);
      return;
    }

    const group = indexed.groups.get(subscription.consumerGroup);
    if (group) {
      group.push(subscription);
      return;
    }

    indexed.groups.set(subscription.consumerGroup, [subscription]);
  }

  private deleteSubscription(subscription: SubscriptionRecord<Catalog>) {
    if (!this.subscriptions.delete(subscription.id)) return;

    subscription.queue.clear();

    const indexed = this.subscriptionsByType.get(subscription.type);
    if (!indexed) return;

    if (!subscription.consumerGroup) {
      this.removeSubscription(indexed.direct, subscription.id);
      if (indexed.direct.length === 0 && indexed.groups.size === 0) {
        this.subscriptionsByType.delete(subscription.type);
        this.groupCursors.delete(subscription.type);
      }
      return;
    }

    const group = indexed.groups.get(subscription.consumerGroup);
    if (!group) return;

    this.removeSubscription(group, subscription.id);
    if (group.length === 0) {
      indexed.groups.delete(subscription.consumerGroup);
      this.groupCursors.get(subscription.type)?.delete(subscription.consumerGroup);
      if (this.groupCursors.get(subscription.type)?.size === 0) {
        this.groupCursors.delete(subscription.type);
      }
    }

    if (indexed.direct.length === 0 && indexed.groups.size === 0) {
      this.subscriptionsByType.delete(subscription.type);
      this.groupCursors.delete(subscription.type);
    }
  }

  private getIndexedSubscriptions(type: MessageType<Catalog>) {
    const existing = this.subscriptionsByType.get(type);
    if (existing) return existing;

    const created: MessageTypeSubscriptions<Catalog> = {
      direct: [],
      groups: new Map(),
    };
    this.subscriptionsByType.set(type, created);
    return created;
  }

  private getGroupCursors(type: MessageType<Catalog>) {
    const existing = this.groupCursors.get(type);
    if (existing) return existing;

    const created = new Map<string, number>();
    this.groupCursors.set(type, created);
    return created;
  }

  private removeSubscription(subscriptions: SubscriptionRecord<Catalog>[], id: string) {
    const index = subscriptions.findIndex((subscription) => subscription.id === id);
    if (index === -1) return;
    subscriptions.splice(index, 1);
  }
}
