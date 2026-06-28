import { Effect, Layer } from "effect";
import {
  isLocalControlSupportedPlatform,
  PlatformSupport,
  unsupportedLocalControlPlatformError,
} from "../../process/platform-support";

const ensureLocalControlSupported = Effect.sync(() => process.platform).pipe(
  Effect.flatMap((platform) =>
    isLocalControlSupportedPlatform(platform)
      ? Effect.void
      : Effect.fail(unsupportedLocalControlPlatformError(platform)),
  ),
);

export const nodePlatformSupportLayer = Layer.succeed(PlatformSupport, {
  ensureLocalControlSupported,
});
