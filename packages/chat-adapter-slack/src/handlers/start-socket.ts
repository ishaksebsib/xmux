import { Result } from "better-result";
import type { SlackBotClient } from "../client";
import { SlackStartError } from "../errors";

export function startSocket(args: {
  readonly client: SlackBotClient;
}): Promise<Result<void, SlackStartError>> {
  return Result.tryPromise({
    try: async () => args.client.start(),
    catch: (cause) => new SlackStartError({ operation: "socket_mode", cause }),
  });
}
