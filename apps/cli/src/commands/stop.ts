import { Command } from "effect/unstable/cli";
import { configPathFlag } from "./options";

export const stopCommand = Command.make("stop", {
  configPath: configPathFlag,
}).pipe(
  Command.withDescription("Stop the xmux server gracefully."),
  Command.withShortDescription("Stop the server."),
);
