import { Cause } from "effect";
import { renderCliCause, shouldRenderDebugErrors } from "../../output/errors";

export const renderCliFailureNode = (cause: Cause.Cause<unknown>): void => {
  console.error(renderCliCause(cause, shouldRenderDebugErrors(process.argv)));
  process.exitCode = 1;
};
