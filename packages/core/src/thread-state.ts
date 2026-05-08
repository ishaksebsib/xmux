import { resolve } from "node:path";
import type { XmuxSessionId } from "./session";

export type XmuxAttachedSession = {
  readonly xmuxSessionId: XmuxSessionId;
  readonly harnessId: string;
  readonly harnessSessionId: string;
};

export type XmuxThreadState = {
  readonly cwd: string;
  readonly session: XmuxAttachedSession | null;
};

export function createXmuxThreadState(args: {
  readonly cwd: string;
  readonly session: XmuxAttachedSession | null;
}): XmuxThreadState {
  return {
    cwd: resolve(args.cwd),
    session: args.session,
  };
}

export function resolveWorkingDirectory(
  state: XmuxThreadState | null,
  defaultWorkingDirectory: string,
): string {
  return state?.cwd ?? resolve(defaultWorkingDirectory);
}
