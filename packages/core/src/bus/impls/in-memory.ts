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

export type CreateMemoryBusInput<Catalog extends MessageCatalog> = {
  readonly catalog: MessageCatalogDefinition<Catalog>;
  readonly onDeadLetter?: (deadLetter: DeadLetter<Catalog>) => Promise<void> | void;
};

type SubscriptionRecord<Catalog extends MessageCatalog> = {
  readonly id: string;
  readonly type: MessageType<Catalog>;
  readonly name: string;
  readonly consumerGroup?: string;
  readonly concurrency: number;
  readonly maxRetries: number;
  readonly handler: MessageHandler<AnyMessage<Catalog>>;
  readonly queue: AnyMessage<Catalog>[];
  readonly controllers: Set<AbortController>;
  active: number;
  closed: boolean;
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
  private readonly groupCursors = new Map<string, number>();
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
      queue: [],
      controllers: new Set(),
      active: 0,
      closed: false,
    };

    this.subscriptions.set(id, record);

    return Result.ok({
      id,
      name: input.name,
      unsubscribe: () => {
        record.closed = true;
        this.subscriptions.delete(id);
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
    for (const subscription of this.resolveSubscriptions(message)) {
      subscription.queue.push(message);
      this.drainSubscription(subscription);
    }
  }

  private resolveSubscriptions(message: AnyMessage<Catalog>) {
    const matching = [...this.subscriptions.values()].filter(
      (subscription) => !subscription.closed && subscription.type === message.type,
    );
    const direct = matching.filter((subscription) => !subscription.consumerGroup);
    const groups = new Map<string, SubscriptionRecord<Catalog>[]>();

    for (const subscription of matching) {
      if (!subscription.consumerGroup) continue;
      const group = groups.get(subscription.consumerGroup) ?? [];
      group.push(subscription);
      groups.set(subscription.consumerGroup, group);
    }

    const grouped = [...groups.entries()].map(([groupName, subscriptions]) => {
      const cursorKey = `${message.type}:${groupName}`;
      const cursor = this.groupCursors.get(cursorKey) ?? 0;
      const subscription = subscriptions[cursor % subscriptions.length];
      this.groupCursors.set(cursorKey, cursor + 1);
      return subscription;
    });

    return [...direct, ...grouped].filter(
      (subscription): subscription is SubscriptionRecord<Catalog> => Boolean(subscription),
    );
  }

  private drainSubscription(subscription: SubscriptionRecord<Catalog>) {
    while (!subscription.closed && subscription.active < subscription.concurrency) {
      const message = subscription.queue.shift();
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

    await this.input.onDeadLetter?.({
      message: input.message,
      error: lastError,
      attempts: input.subscription.maxRetries + 1,
      subscription: {
        id: input.subscription.id,
        name: input.subscription.name,
        consumerGroup: input.subscription.consumerGroup,
      },
    });
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
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private hasPendingWork() {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.active > 0 || subscription.queue.length > 0) return true;
    }

    return false;
  }

  private closeSubscriptions() {
    for (const subscription of this.subscriptions.values()) {
      subscription.closed = true;
      subscription.queue.length = 0;
    }

    this.subscriptions.clear();
  }
}
