# XMUX

#### Control your coding agents from anywhere, Discord, Slack, Telegram.

Privacy-first, your Agents, your chat bot, on your own machine.

## Installation

### macOS / Linux

```sh
npm i -g @xmux/cli
```
### Nix

```sh
nix run github:ishaksebsib/xmux
```

## Configuration

OpenCode with Telegram:

`~/.config/xmux/config.jsonc`
```jsonc
{
  "harnesses": {
    "opencode": {
      "enabled": true
    }
  },
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "value": "your-bot-token" },
      "access": { "type": "allow-list", "users": ["your-user-id"] }
    }
  }
}
```

## Run

```sh
xmux start
```

This starts the server. Chat with your AI from your preferred platform.

### Chat adapters

Add one or more chat adapters under `"chats"`.

<details>
<summary>Telegram</summary>

```jsonc
{
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "env": "TELEGRAM_BOT_TOKEN" }, // or { "value": "your-token" }
      "access": { "type": "allow-list", "users": ["your-telegram-user-id"] }
    }
  }
}
```

</details>

<details>
<summary>Discord</summary>

```jsonc
{
  "chats": {
    "discord": {
      "enabled": true,
      "token": { "env": "DISCORD_BOT_TOKEN" }, // or { "value": "your-bot-token" }
      "applicationId": "your-discord-application-id",
      "guildId": "your-discord-guild-id",
      "access": { "type": "allow-list", "users": ["your-discord-user-id"] }
    }
  }
}
```

</details>

<details>
<summary>Slack</summary>

```jsonc
{
  "chats": {
    "slack": {
      "enabled": true,
      "botToken": { "env": "SLACK_BOT_TOKEN" }, // or { "value": "your-bot-token" }
      "appToken": { "env": "SLACK_APP_TOKEN" }, // or { "value": "..." }
      "access": { "type": "allow-list", "users": ["your-slack-user-id"] }
    }
  }
}
```

</details>

## License

MIT
