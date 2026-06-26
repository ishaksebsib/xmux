import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { rootCommand } from "./commands/root";

export { rootCommand } from "./commands/root";

export const cliVersion = packageJson.version;

export const cliProgram = Command.run(rootCommand, {
  version: cliVersion,
});
