import { Command } from "effect/unstable/cli";
import { configPathFlag } from "./options";

export const startCommand = Command.make("start", {
  configPath: configPathFlag,
}).pipe(
  Command.withDescription("Start the xmux server and wait until it is ready."),
  Command.withShortDescription("Start the server."),
);
