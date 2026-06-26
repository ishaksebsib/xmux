import type { Path } from "effect";

export const expandHome = (pathService: Path.Path, homeDir: string, input: string): string => {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return pathService.join(homeDir, input.slice(2));
  return input;
};
