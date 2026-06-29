import { Context, Effect } from "effect";
import { CliInactiveConfigSummary } from "../domain/status";

export interface ConfigSummaryService {
  readonly load: (configPath: string) => Effect.Effect<CliInactiveConfigSummary>;
}

export class ConfigSummary extends Context.Service<ConfigSummary, ConfigSummaryService>()(
  "@xmux/cli/ConfigSummary",
) {}
