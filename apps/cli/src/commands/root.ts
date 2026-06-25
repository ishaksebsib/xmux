import { Command } from "effect/unstable/cli";
import { logsCommand } from "./logs";
import { restartCommand } from "./restart";
import { serverCommand } from "./server-run";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { stopCommand } from "./stop";

export const rootCommand = Command.make("xmux").pipe(
  Command.withDescription("Manage xmux server lifecycle and diagnostics."),
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    logsCommand,
    restartCommand,
    serverCommand,
  ]),
);
