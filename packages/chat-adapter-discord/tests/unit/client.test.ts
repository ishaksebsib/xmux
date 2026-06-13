import { describe, expect, test } from "vitest";
import { createDiscordBotClient } from "../../src/client";
import type { DiscordBotToken } from "../../src/config";

describe("Discord bot client", () => {
  test("omits empty partials when creating a default gateway client", () => {
    const client = createDiscordBotClient({
      token: "token" as DiscordBotToken,
      mode: { type: "gateway" },
    });

    expect(client.getBotUserId()).toBeUndefined();
    client.destroy();
  });
});
