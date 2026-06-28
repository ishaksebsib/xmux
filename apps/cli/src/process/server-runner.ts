import { Context, Effect } from "effect";
import type { CliServerRunFailed, CliUnsupportedPlatform } from "../domain/errors";
import type { CliConfigPath } from "../domain/input";

export interface ServerRunnerService {
  readonly runForeground: (input: {
    readonly configPath: CliConfigPath | undefined;
  }) => Effect.Effect<void, CliServerRunFailed | CliUnsupportedPlatform>;
}

export class ServerRunner extends Context.Service<ServerRunner, ServerRunnerService>()(
  "@xmux/cli/ServerRunner",
) {}
