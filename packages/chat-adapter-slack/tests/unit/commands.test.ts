import {
  booleanOption,
  defineChatCommand,
  defineChatCommands,
  numberOption,
  stringOption,
} from "@xmux/chat-core";
import { describe, expect, test } from "vitest";
import { createSlackCommandRegistration } from "../../src/commands";
import { parseSlackCommand, parseSlackMentionCommand } from "../../src/commands/parse";

describe("Slack slash command parsing", () => {
  const commands = defineChatCommands({
    deploy: defineChatCommand({
      description: "Deploy a service",
      options: {
        service: stringOption({ required: true, choices: ["api", "worker"] as const }),
        replicas: numberOption(),
        dryRun: booleanOption(),
      },
    }),
    echo: defineChatCommand({
      description: "Echo text",
      options: {
        text: stringOption({ required: true }),
      },
    }),
  });

  test("direct mode maps the Slack slash command to an xmux command", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "direct" },
      payload: slashCommand({ command: "/deploy", text: "--service api --replicas 3 --dryRun" }),
    });

    expect(parsed.status).toBe("command");
    if (parsed.status === "command") {
      expect(parsed.command).toEqual({
        name: "deploy",
        options: { service: "api", replicas: 3, dryRun: true },
      });
    }
  });

  test("root mode reads the command name from the first text token", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "root", command: "/xmux" },
      payload: slashCommand({ command: "/xmux", text: 'echo --text "hello team"' }),
    });

    expect(parsed.status).toBe("command");
    if (parsed.status === "command") {
      expect(parsed.command).toEqual({ name: "echo", options: { text: "hello team" } });
    }
  });

  test("positional options are supported when no named options are present", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "root", command: "/xmux" },
      payload: slashCommand({ command: "/xmux", text: "echo hello positional world" }),
    });

    expect(parsed.status).toBe("command");
    if (parsed.status === "command") {
      expect(parsed.command.options).toEqual({ text: "hello positional world" });
    }
  });

  test("unknown commands are reported", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "direct" },
      payload: slashCommand({ command: "/missing", text: "" }),
    });

    expect(parsed).toEqual({ status: "unknown", commandName: "missing" });
  });

  test("root mode does not accept direct slash commands", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "root", command: "/xmux" },
      payload: slashCommand({ command: "/deploy", text: "--service api" }),
    });

    expect(parsed).toEqual({ status: "unknown", commandName: "deploy" });
  });

  test("invalid options include command and option context", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "direct" },
      payload: slashCommand({ command: "/deploy", text: "--service web" }),
    });

    expect(parsed).toEqual({
      status: "invalid",
      commandName: "deploy",
      optionName: "service",
      reason: "value must be one of: api, worker",
    });
  });

  test("root mode without a subcommand is invalid", () => {
    const parsed = parseSlackCommand({
      commands,
      commandMode: { type: "root", command: "/xmux" },
      payload: slashCommand({ command: "/xmux", text: "   " }),
    });

    expect(parsed).toEqual({
      status: "invalid",
      commandName: "xmux",
      reason: "root command requires a command name",
    });
  });
});

describe("Slack app mention command parsing", () => {
  const commands = defineChatCommands({
    deploy: defineChatCommand({
      description: "Deploy a service",
      options: {
        service: stringOption({ required: true }),
      },
    }),
  });

  test("maps a bot mention followed by a command name", () => {
    const parsed = parseSlackMentionCommand({
      commands,
      botUserId: "U_BOT",
      text: "<@U_BOT> deploy --service api",
    });

    expect(parsed.status).toBe("command");
    if (parsed.status === "command") {
      expect(parsed.command).toEqual({ name: "deploy", options: { service: "api" } });
    }
  });

  test("ignores non-command prose after the bot mention", () => {
    const parsed = parseSlackMentionCommand({
      commands,
      botUserId: "U_BOT",
      text: "<@U_BOT> please deploy api",
    });

    expect(parsed).toEqual({
      status: "not_command",
      reason: "unknown_command",
      commandName: "please",
    });
  });

  test("slash-prefixed unknown mention commands emit command.unknown", () => {
    const parsed = parseSlackMentionCommand({
      commands,
      botUserId: "U_BOT",
      text: "<@U_BOT> /missing --service api",
    });

    expect(parsed).toEqual({ status: "unknown", commandName: "missing" });
  });

  test("validates options for known mention commands", () => {
    const parsed = parseSlackMentionCommand({
      commands,
      botUserId: "U_BOT",
      text: "<@U_BOT> deploy",
    });

    expect(parsed).toEqual({
      status: "invalid",
      commandName: "deploy",
      optionName: "service",
      reason: "required option is missing",
    });
  });
});

describe("Slack manual command registration", () => {
  test("direct mode describes one manually configured Slack command per xmux command", () => {
    const registration = createSlackCommandRegistration({
      commandMode: { type: "direct" },
      commands: defineChatCommands({
        echo: defineChatCommand({ description: "Echo text" }),
      }),
    });

    expect(registration.registration).toBe("manual");
    expect(registration.commands).toEqual([
      { command: "/echo", description: "Echo text", usageHint: "/echo" },
    ]);
  });

  test("root mode describes the single manually configured root command", () => {
    const registration = createSlackCommandRegistration({
      commandMode: { type: "root", command: "/xmux" },
      commands: defineChatCommands({
        echo: defineChatCommand({ description: "Echo text" }),
        deploy: defineChatCommand({ description: "Deploy" }),
      }),
    });

    expect(registration.commands).toEqual([
      {
        command: "/xmux",
        description: "xmux chat command router",
        usageHint: "/xmux <echo|deploy> [options]",
      },
    ]);
  });
});

function slashCommand(args: { readonly command: string; readonly text: string }) {
  return {
    token: "legacy-token",
    command: args.command,
    text: args.text,
    response_url: "https://hooks.slack.test/commands/1",
    trigger_id: "trigger-1",
    user_id: "U123",
    user_name: "riley",
    team_id: "T123",
    team_domain: "example",
    channel_id: "C123",
    channel_name: "general",
    api_app_id: "A123",
  };
}
