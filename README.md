# xmux

Local control plane for coding-agent harnesses like Codex, Claude Code, OpenCode, and PI, accessible from chat platforms such as Telegram, Discord, and Slack.

## Status

`xmux` is under active development. The CLI is published as `@xmux/cli` and exposes the `xmux` command.

## Installation

Requires Node.js `>=22.19.0` and pnpm.

Install the CLI globally:

```sh
pnpm i -g @xmux/cli
```

Verify the install:

```sh
xmux --version
```

## What xmux is

`xmux` runs on your machine and acts as a bridge between:

- local agent harnesses
- remote chat platforms

The goal is to let users create sessions, continue sessions, receive output, and control coding-agent workflows from platforms like Telegram, Discord, and Slack, while the actual agent harness runs locally on the user's computer.

## Planned support

- Codex
- Claude Code
- OpenCode
- PI
- Telegram
- Discord
- Slack

## License

MIT
