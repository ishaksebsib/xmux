import type { CliRunningServer } from "./discovery";

export interface CliLogsReport<Response> {
  readonly _tag: "Logs";
  readonly server: CliRunningServer;
  readonly response: Response;
}

export const logsReport = <Response>(
  server: CliRunningServer,
  response: Response,
): CliLogsReport<Response> => ({
  _tag: "Logs",
  server,
  response,
});
