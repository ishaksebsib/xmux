import { Command } from "effect/unstable/cli";
import { configPathFlag } from "./options";

export const restartCommand = Command.make("restart", {
  configPath: configPathFlag,
}).pipe(
  Command.withDescription("Restart the xmux server."),
  Command.withShortDescription("Restart the server."),
);
