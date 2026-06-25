import { Command } from "effect/unstable/cli";
import { configPathFlag, jsonOutputFlag } from "./options";

export const statusCommand = Command.make("status", {
  configPath: configPathFlag,
  json: jsonOutputFlag,
}).pipe(
  Command.withDescription("Show xmux server status."),
  Command.withShortDescription("Show server status."),
);
