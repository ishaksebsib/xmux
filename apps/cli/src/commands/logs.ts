import { Command, Flag } from "effect/unstable/cli";
import { configPathFlag, jsonOutputFlag } from "./options";

const tailFlag = Flag.integer("tail").pipe(
  Flag.optional,
  Flag.withDescription("Number of recent server log entries to print."),
);

export const logsCommand = Command.make("logs", {
  configPath: configPathFlag,
  tail: tailFlag,
  json: jsonOutputFlag,
}).pipe(
  Command.withDescription("Show recent xmux server logs."),
  Command.withShortDescription("Show server logs."),
);
