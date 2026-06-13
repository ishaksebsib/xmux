import { Result } from "better-result";
import type { DiscordBotClient } from "../client";
import type { DiscordBotToken } from "../config";
import { DiscordStartError } from "../errors";

export function startGateway(args: {
  readonly client: DiscordBotClient;
  readonly token: DiscordBotToken;
}): Promise<Result<void, DiscordStartError>> {
  return Result.tryPromise({
    try: async () => args.client.login(args.token),
    catch: (cause) => new DiscordStartError({ operation: "login", cause }),
  });
}
