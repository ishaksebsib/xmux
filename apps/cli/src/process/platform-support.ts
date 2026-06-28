import { Context, Effect } from "effect";
import { CliUnsupportedPlatform } from "../domain/errors";

export const unsupportedWindowsLocalControlMessage =
  "Windows local control is unsupported until named pipes are implemented.";

export const isLocalControlSupportedPlatform = (platform: string): boolean => platform !== "win32";

export const unsupportedLocalControlPlatformError = (platform: string): CliUnsupportedPlatform =>
  new CliUnsupportedPlatform({
    message: unsupportedWindowsLocalControlMessage,
    platform,
  });

export interface PlatformSupportService {
  readonly ensureLocalControlSupported: Effect.Effect<void, CliUnsupportedPlatform>;
}

export class PlatformSupport extends Context.Service<PlatformSupport, PlatformSupportService>()(
  "@xmux/cli/PlatformSupport",
) {}
