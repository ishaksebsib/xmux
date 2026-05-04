import {
  AdapterRegistry,
  createBus,
  OpenCodeHarnessAdapter,
  Router,
  TelegramMediaAdapter,
} from "@xmux/core";
import { config } from "dotenv";

config({ path: ["app/demo/.env", ".env"], quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token)
  throw new Error("TELEGRAM_BOT_TOKEN is required in app/demo/.env, root .env, or process env");

const bus = createBus();
const registry = new AdapterRegistry(bus);
const opencode = new OpenCodeHarnessAdapter({ cwd: process.env.XMUX_CWD });
const telegram = new TelegramMediaAdapter(bus, { botToken: token });

registry.register(opencode);
registry.register(telegram);

new Router(bus, registry);

const busStart = await bus.start();
if (busStart.isErr()) throw busStart.error;
const registryStart = await registry.startAll();
if (registryStart.isErr()) throw registryStart.error;

console.log("xmux demo running. Send `new opencode` to the Telegram bot.");

process.once("SIGINT", () => {
  void (async () => {
    await registry.stopAll();
    const busStop = await bus.stop();
    if (busStop.isErr()) throw busStop.error;
    process.exit(0);
  })();
});
