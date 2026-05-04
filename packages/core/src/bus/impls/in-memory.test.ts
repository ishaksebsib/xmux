import { describe, expect, test } from "vitest";
import {
	BusNotRunningError,
	InvalidSubscriptionOptionsError,
	createMemoryBus,
	createMessageSource,
	type MessageDefinition,
	type MessageOf,
} from "..";

type TestCatalog = {
	readonly "xmux.test.happened": MessageDefinition<"event", { readonly value: string }>;
};

type TestHappenedMessage = MessageOf<TestCatalog, "xmux.test.happened">;

const catalog = {
	"xmux.test.happened": { kind: "event" },
} satisfies Parameters<typeof createMemoryBus<TestCatalog>>[0]["catalog"];

const source = createMessageSource("xmux.test");

describe("memory message bus", () => {
	test("rejects publish before start", async () => {
		const bus = createMemoryBus<TestCatalog>({ catalog });

		const published = await bus.publish({
			type: "xmux.test.happened",
			data: { value: "hello" },
			source,
		});

		expect(published.isErr()).toBe(true);
		if (published.isErr()) expect(published.error).toBeInstanceOf(BusNotRunningError);
	});

	test("delivers typed messages with envelope metadata", async () => {
		const bus = createMemoryBus<TestCatalog>({ catalog });
		const delivered = new Promise<TestHappenedMessage>((resolve) => {
			void bus
				.subscribe({
					type: "xmux.test.happened",
					name: "test-subscriber",
					handler: (message) => resolve(message),
				})
				.then((subscribed) => subscribed.unwrap("test subscription failed"));
		});

		const started = await bus.start();
		started.unwrap("test bus start failed");
		const receipt = await bus
			.publish({
				type: "xmux.test.happened",
				data: { value: "hello" },
				source,
				subject: "subject-1",
			})
			.then((published) => published.unwrap("test publish failed"));

		const message = await delivered;

		expect(message.id).toBe(receipt.messageId);
		expect(message.correlationId).toBe(receipt.correlationId);
		expect(message.kind).toBe("event");
		expect(message.source).toBe(source);
		expect(message.subject).toBe("subject-1");
		expect(message.data.value).toBe("hello");
	});

	test("load balances subscribers in the same consumer group", async () => {
		const bus = createMemoryBus<TestCatalog>({ catalog });
		const deliveries: string[] = [];

		const workerA = await bus.subscribe({
			type: "xmux.test.happened",
			name: "worker-a",
			consumerGroup: "workers",
			handler: () => {
				deliveries.push("a");
			},
		});
		workerA.unwrap("worker-a subscription failed");
		const workerB = await bus.subscribe({
			type: "xmux.test.happened",
			name: "worker-b",
			consumerGroup: "workers",
			handler: () => {
				deliveries.push("b");
			},
		});
		workerB.unwrap("worker-b subscription failed");

		const started = await bus.start();
		started.unwrap("test bus start failed");
		const one = await bus.publish({ type: "xmux.test.happened", data: { value: "one" }, source });
		one.unwrap("first test publish failed");
		const two = await bus.publish({ type: "xmux.test.happened", data: { value: "two" }, source });
		two.unwrap("second test publish failed");
		await waitFor(() => deliveries.length === 2);

		expect(deliveries).toEqual(["a", "b"]);
	});

	test("retries failed handlers before dead lettering", async () => {
		const deadLetters: unknown[] = [];
		const bus = createMemoryBus<TestCatalog>({
			catalog,
			onDeadLetter: (deadLetter) => {
				deadLetters.push(deadLetter);
			},
		});
		let attempts = 0;

		const subscribed = await bus.subscribe({
			type: "xmux.test.happened",
			name: "failing-worker",
			maxRetries: 1,
			handler: () => {
				attempts += 1;
				throw new Error("boom");
			},
		});
		subscribed.unwrap("failing-worker subscription failed");

		const started = await bus.start();
		started.unwrap("test bus start failed");
		const published = await bus.publish({
			type: "xmux.test.happened",
			data: { value: "hello" },
			source,
		});
		published.unwrap("test publish failed");
		await waitFor(() => deadLetters.length === 1);

		expect(attempts).toBe(2);
		expect(deadLetters).toHaveLength(1);
	});

	test("stop waits for queued deliveries to drain", async () => {
		const bus = createMemoryBus<TestCatalog>({ catalog });
		const deliveries: string[] = [];
		let releaseFirst!: () => void;
		const firstDelivery = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const subscribed = await bus.subscribe({
			type: "xmux.test.happened",
			name: "drain-worker",
			concurrency: 1,
			handler: async (message) => {
				deliveries.push(`start:${message.data.value}`);
				if (message.data.value === "one") await firstDelivery;
				deliveries.push(`end:${message.data.value}`);
			},
		});
		subscribed.unwrap("drain-worker subscription failed");

		const started = await bus.start();
		started.unwrap("test bus start failed");
		await bus.publish({ type: "xmux.test.happened", data: { value: "one" }, source });
		await bus.publish({ type: "xmux.test.happened", data: { value: "two" }, source });
		await waitFor(() => deliveries.includes("start:one"));

		const stopping = bus.stop();
		releaseFirst();
		const stopped = await stopping;
		stopped.unwrap("test bus stop failed");

		expect(deliveries).toEqual(["start:one", "end:one", "start:two", "end:two"]);
	});

	test("rejects invalid subscription options", async () => {
		const bus = createMemoryBus<TestCatalog>({ catalog });

		const zeroConcurrency = await bus.subscribe({
			type: "xmux.test.happened",
			name: "bad-concurrency",
			concurrency: 0,
			handler: () => undefined,
		});
		expect(zeroConcurrency.isErr()).toBe(true);
		if (zeroConcurrency.isErr()) {
			expect(zeroConcurrency.error).toBeInstanceOf(InvalidSubscriptionOptionsError);
		}

		const invalidRetries = await bus.subscribe({
			type: "xmux.test.happened",
			name: "bad-retries",
			maxRetries: Number.NaN,
			handler: () => undefined,
		});
		expect(invalidRetries.isErr()).toBe(true);
		if (invalidRetries.isErr()) {
			expect(invalidRetries.error).toBeInstanceOf(InvalidSubscriptionOptionsError);
		}
	});
});

async function waitFor(predicate: () => boolean) {
	for (let index = 0; index < 20; index += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error("Timed out waiting for condition");
}
