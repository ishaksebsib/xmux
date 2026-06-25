import { describe, expect, it } from "vitest";
import { rootCommand } from "../src/commands/root";

const childNames = (command: typeof rootCommand): ReadonlyArray<string> =>
  command.subcommands.flatMap((group) => group.commands.map((child) => child.name));

describe("root command", () => {
  it("declares the public root command surface", () => {
    expect(childNames(rootCommand)).toEqual([
      "start",
      "stop",
      "status",
      "logs",
      "restart",
      "server",
    ]);
  });

  it("declares the server run command", () => {
    const server = rootCommand.subcommands
      .flatMap((group) => group.commands)
      .find((command) => command.name === "server");

    if (!server) throw new Error("server command is missing");

    expect(
      server.subcommands.flatMap((group) => group.commands.map((child) => child.name)),
    ).toEqual(["run"]);
  });
});
