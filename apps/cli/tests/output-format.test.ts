import { describe, expect, it } from "@effect/vitest";
import { formatJson } from "../src/output/format";
import { cell, renderSections, row, statusCell } from "../src/output/layout";
import { plainCliOutputCapabilities, type CliOutputCapabilities } from "../src/output/capabilities";
import { stripAnsi } from "../src/output/theme";
import { detectColorEnabled } from "../src/platform/node/terminal";

const colorCliOutputCapabilities: CliOutputCapabilities = {
  color: true,
  unicode: true,
};

const renderSampleSection = (capabilities: CliOutputCapabilities): string =>
  renderSections(capabilities, [
    {
      title: "XMUX",
      rows: [row(cell("server", "label"), statusCell(capabilities, "ready", "success"))],
    },
  ]);

describe("CLI output formatting", () => {
  it("formats undefined as valid JSON null", () => {
    expect(formatJson(undefined)).toBe("null\n");
  });

  it("keeps colored output ANSI-strippable to the same plain layout", () => {
    const plain = renderSampleSection(plainCliOutputCapabilities);
    const colored = renderSampleSection(colorCliOutputCapabilities);

    expect(colored).toContain("\x1b[32m");
    expect(stripAnsi(colored)).toBe(plain);
  });

  it("detects terminal color capability from TTY and environment", () => {
    const env = {
      forceColor: undefined,
      noColor: undefined,
      term: "xterm-256color",
      xmuxAscii: undefined,
    };

    expect(detectColorEnabled({ isTty: true, platform: "linux", env })).toBe(true);
    expect(detectColorEnabled({ isTty: false, platform: "linux", env })).toBe(false);
    expect(
      detectColorEnabled({
        isTty: true,
        platform: "linux",
        env: { ...env, noColor: "1" },
      }),
    ).toBe(false);
    expect(
      detectColorEnabled({
        isTty: false,
        platform: "linux",
        env: { ...env, forceColor: "1" },
      }),
    ).toBe(true);
  });
});
