import type { ChatCommandRegistry } from "@xmux/chat-core";
import { slackLogEvents, type SlackLogScope } from "../logger";
import type { SlackCommandMode } from "../types";

export interface SlackManualSlashCommand {
  readonly command: string;
  readonly description: string;
  readonly usageHint: string;
}

export interface SlackManualCommandRegistration {
  readonly registration: "manual";
  readonly mode: SlackCommandMode;
  readonly commands: readonly SlackManualSlashCommand[];
  readonly notes: readonly string[];
}

export function createSlackCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly commandMode: SlackCommandMode;
  readonly logger?: SlackLogScope;
}): SlackManualCommandRegistration {
  const registration =
    args.commandMode.type === "direct"
      ? createDirectCommandRegistration({
          commands: args.commands,
          commandMode: args.commandMode,
        })
      : createRootCommandRegistration({
          commands: args.commands,
          commandMode: args.commandMode,
        });

  args.logger?.info(slackLogEvents.commandsManual, {
    operation: "registerCommands",
    registration: "manual",
    commandMode: args.commandMode.type,
    commandCount: Object.keys(args.commands).length,
    slackCommandCount: registration.commands.length,
  });

  return registration;
}

function createDirectCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly commandMode: Extract<SlackCommandMode, { readonly type: "direct" }>;
}): SlackManualCommandRegistration {
  return {
    registration: "manual",
    mode: args.commandMode,
    commands: Object.entries(args.commands).map(([name, command]) => ({
      command: `/${name}`,
      description: command.description,
      usageHint: createUsageHint({ command: `/${name}`, options: command.options }),
    })),
    notes: [
      "Create one Slack slash command for each xmux command in the Slack app dashboard or manifest.",
      "Point every slash command at the app that is connected with Socket Mode.",
    ],
  };
}

function createRootCommandRegistration<TCommands extends ChatCommandRegistry>(args: {
  readonly commands: TCommands;
  readonly commandMode: Extract<SlackCommandMode, { readonly type: "root" }>;
}): SlackManualCommandRegistration {
  const commandNames = Object.keys(args.commands);

  return {
    registration: "manual",
    mode: args.commandMode,
    commands: [
      {
        command: args.commandMode.command,
        description: "xmux chat command router",
        usageHint: `${args.commandMode.command} <${commandNames.join("|") || "command"}> [options]`,
      },
    ],
    notes: [
      "Create the single root Slack slash command in the Slack app dashboard or manifest.",
      "Users invoke xmux commands by passing the command name as the first argument.",
    ],
  };
}

function createUsageHint(args: {
  readonly command: string;
  readonly options: ChatCommandRegistry[string]["options"];
}): string {
  const options = Object.entries(args.options ?? {}).map(([name, option]) => {
    const hint = option.kind === "boolean" ? `--${name}` : `--${name} <${option.kind}>`;
    return option.required === true ? hint : `[${hint}]`;
  });

  return [args.command, ...options].join(" ");
}
