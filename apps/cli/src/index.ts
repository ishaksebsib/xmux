import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { rootCommand } from "./commands/root";

export { rootCommand } from "./commands/root";

export const cliVersion = packageJson.version;

export const cliProgram = Command.run(rootCommand, {
  version: cliVersion,
});

export const runCli = (): void => {
  cliProgram.pipe(Effect.provide(NodeServices.layer), Effect.scoped, NodeRuntime.runMain);
};
