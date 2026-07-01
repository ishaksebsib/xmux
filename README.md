# XMUX

**Control your coding agents from anywhere:** Discord, Slack, Telegram.

> **Privacy-first**: your **agents** and your **chat-bot** run on your own **machine**.

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

`~/.config/xmux/config.jsonc`

**OpenCode** with Telegram:

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

For every supported option, see the [full config reference](apps/server/config.example.jsonc).

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
      "token": { "env": "TELEGRAM_BOT_TOKEN" },
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
      "token": { "env": "DISCORD_BOT_TOKEN" },
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

You can create the Slack app manually, or start from the ready-to-copy manifest:

[`packages/chat-adapter-slack/slack-app-manifest.yml`](packages/chat-adapter-slack/slack-app-manifest.yml)

```jsonc
{
  "chats": {
    "slack": {
      "enabled": true,
      "botToken": { "env": "SLACK_BOT_TOKEN" },
      "appToken": { "env": "SLACK_APP_TOKEN" },
      "access": { "type": "allow-list", "users": ["your-slack-user-id"] }
    }
  }
}
```

</details>

### STT (Optional)

Enable speech-to-text to transcribe for **Voice Prompting**.

<details>
<summary>OpenAI STT</summary>

```jsonc
{
  "stt": {
    "enabled": true,
    "apiKey": { "env": "OPENAI_API_KEY" },
    "model": "gpt-4o-mini-transcribe"
  }
}
```

</details>

<details>
<summary>OpenAI-compatible / local AI STT</summary>

```jsonc
{
  "stt": {
    "enabled": true,
    "provider": "openai-compatible",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "endpointPath": "/audio/transcriptions",
    "model": "whisper-local"
  }
}
```

</details>


### Secrets
Prefer environment variables for secrets:

```jsonc
{ "env": "TELEGRAM_BOT_TOKEN" }
```

Inline values are supported for quick local testing:

```jsonc
{ "value": "your-token" }
```

## License

MIT
