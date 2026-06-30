import { Layer } from "effect";
import { CliOutputStyle, type CliOutputCapabilities } from "../../output/capabilities";

interface TerminalEnvironment {
  readonly forceColor: string | undefined;
  readonly noColor: string | undefined;
  readonly term: string | undefined;
  readonly xmuxAscii: string | undefined;
}

interface TerminalDetectionInput {
  readonly isTty: boolean;
  readonly platform: NodeJS.Platform;
  readonly env: TerminalEnvironment;
}

const enabledEnvironmentFlag = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

const forcedColor = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return true;
};

export const detectColorEnabled = (input: TerminalDetectionInput): boolean => {
  const forced = forcedColor(input.env.forceColor);
  if (forced !== undefined) return forced;
  if (enabledEnvironmentFlag(input.env.noColor)) return false;
  if (!input.isTty) return false;
  return input.env.term !== "dumb";
};

export const detectUnicodeEnabled = (input: TerminalDetectionInput): boolean => {
  if (enabledEnvironmentFlag(input.env.xmuxAscii)) return false;
  if (input.env.term === "dumb") return false;
  return input.platform !== "win32" || input.isTty;
};

export const detectNodeOutputCapabilities = (): CliOutputCapabilities => {
  const input: TerminalDetectionInput = {
    isTty: process.stdout.isTTY === true,
    platform: process.platform,
    env: {
      forceColor: process.env.FORCE_COLOR,
      noColor: process.env.NO_COLOR,
      term: process.env.TERM,
      xmuxAscii: process.env.XMUX_ASCII,
    },
  };

  return {
    color: detectColorEnabled(input),
    unicode: detectUnicodeEnabled(input),
  };
};

export const nodeCliOutputStyleLayer = Layer.sync(CliOutputStyle, detectNodeOutputCapabilities);
