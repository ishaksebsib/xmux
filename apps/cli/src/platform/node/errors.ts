import { Cause } from "effect";
import { renderCliFailure, shouldRenderDebugErrors } from "../../output/errors";
import { detectNodeOutputCapabilities } from "./terminal";

export const renderCliFailureNode = (cause: Cause.Cause<unknown>): void => {
  console.error(
    renderCliFailure(cause, shouldRenderDebugErrors(process.argv), detectNodeOutputCapabilities()),
  );
  process.exitCode = 1;
};
