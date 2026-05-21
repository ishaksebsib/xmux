import type { GetPwdForThreadError } from "./service";

export function formatPwdSuccess(cwd: string): string {
  return cwd;
}

export function formatPwdFailure(error: GetPwdForThreadError): string {
  return `Failed to read current directory: ${error.message}`;
}

export function formatPwdCommandUsage(): string {
  return "Usage: /pwd";
}
