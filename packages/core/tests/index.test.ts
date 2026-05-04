import { expect, test } from "vitest";
import { BusNotRunningError, createBus, createMessageSource } from "../src";

test("public API creates and starts the default bus", async () => {
  const bus = createBus();

  const started = await bus.start();
  expect(started.isOk()).toBe(true);

  const stopped = await bus.stop();
  expect(stopped.isOk()).toBe(true);
});

test("public API returns typed lifecycle errors", async () => {
  const bus = createBus();

  const published = await bus.publish({
    type: "xmux.adapter.ready",
    data: { adapterId: "test" },
    source: createMessageSource("test"),
  });

  expect(published.isErr()).toBe(true);
  if (published.isErr()) expect(published.error).toBeInstanceOf(BusNotRunningError);
});
