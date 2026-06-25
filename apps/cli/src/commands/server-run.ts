import { Command, Flag } from "effect/unstable/cli";
import { configPathFlag } from "./options";

const foregroundFlag = Flag.boolean("foreground").pipe(
  Flag.withDescription("Run in the foreground process."),
);

export const serverRunCommand = Command.make("run", {
  foreground: foregroundFlag,
  configPath: configPathFlag,
}).pipe(
  Command.withDescription("Run the xmux server in the foreground."),
  Command.withShortDescription("Run the server."),
);

export const serverCommand = Command.make("server").pipe(
  Command.withDescription("Server process commands."),
  Command.withShortDescription("Server commands."),
  Command.withSubcommands([serverRunCommand]),
);
