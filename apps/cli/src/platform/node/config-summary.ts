import { loadNodeConfiguredAdapterSummary } from "@xmux/server/platform/node";
import { Effect, Layer } from "effect";
import { ConfigSummary } from "../../control/config-summary";
import {
  CliInactiveChatAdapterStatus,
  CliInactiveConfigSummary,
  CliInactiveHarnessAdapterStatus,
} from "../../domain/status";

export const nodeConfigSummaryLayer = Layer.succeed(ConfigSummary, {
  load: Effect.fn("cli.configSummary.load")(function* (configPath: string) {
    return yield* loadNodeConfiguredAdapterSummary(configPath).pipe(
      Effect.match({
        onFailure: (): CliInactiveConfigSummary =>
          new CliInactiveConfigSummary({ status: "invalid", chats: [], harnesses: [] }),
        onSuccess: (summary): CliInactiveConfigSummary => {
          if (summary.status === "invalid") {
            return new CliInactiveConfigSummary({ status: "invalid", chats: [], harnesses: [] });
          }

          return new CliInactiveConfigSummary({
            status: "valid",
            chats: summary.chats.map(
              (id) =>
                new CliInactiveChatAdapterStatus({
                  id,
                  state: "configured",
                  runtime: "unavailable",
                }),
            ),
            harnesses: summary.harnesses.map(
              (id) =>
                new CliInactiveHarnessAdapterStatus({
                  id,
                  state: "configured_lazy",
                  runtime: "unavailable",
                }),
            ),
          });
        },
      }),
    );
  }),
});
