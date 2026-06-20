import { Schema } from "effect";

export const NonEmptyString = Schema.String.check(Schema.isNonEmpty());
export type NonEmptyString = typeof NonEmptyString.Type;

export const PositiveInteger = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0));
export type PositiveInteger = typeof PositiveInteger.Type;

export const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
export type NonNegativeNumber = typeof NonNegativeNumber.Type;
