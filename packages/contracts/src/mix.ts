import { Schema } from "effect";
import { Color } from "./color.js";
import { idAlphabet, idSuffixLength } from "./ids.js";
import { nextNumberedResourceNumber } from "./numbered-resource.js";

export const mainMixId = "mix_main" as const;
export const mixIdPrefix = "mix_";
const mixIdPattern = new RegExp(`^${mixIdPrefix}[${idAlphabet}]{${idSuffixLength}}$`);

export const MixId = Schema.Union([
  Schema.Literal(mainMixId),
  Schema.String.pipe(
    Schema.check(
      Schema.isPattern(mixIdPattern, {
        expected: `${mixIdPrefix} followed by ${idSuffixLength} lowercase base36 characters`,
      }),
    ),
  ),
]).pipe(Schema.brand("MixId"));
export type MixId = typeof MixId.Type;

export const MixNumber = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, {
      expected: "a non-empty mix label",
    }),
  ),
  Schema.brand("MixNumber"),
);
export type MixNumber = typeof MixNumber.Type;

export const nextMixNumber = (numbers: Iterable<string>): MixNumber =>
  MixNumber.make(nextNumberedResourceNumber(numbers));

export const Mix = Schema.Struct({
  id: MixId,
  number: MixNumber,
  color: Color,
  name: Schema.optional(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  deletedAt: Schema.optional(Schema.DateTimeUtcFromString),
});
export type Mix = typeof Mix.Type;
