import { Schema } from "effect";
import { CliInvalidInput } from "../domain/errors";

export const mapConfigPathError = (cause: Schema.SchemaError): CliInvalidInput =>
  new CliInvalidInput({
    message: "Invalid --config path.",
    field: "config",
    cause,
  });
