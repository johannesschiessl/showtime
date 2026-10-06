const canonicalPositiveIntegerPattern = /^[1-9]\d*$/;

/** Returns the next automatic label while ignoring custom and unsafe numeric labels. */
export const nextNumberedResourceNumber = (numbers: Iterable<string>): string => {
  let maximum = 0;
  for (const number of numbers) {
    if (!canonicalPositiveIntegerPattern.test(number)) continue;
    const value = Number(number);
    if (Number.isSafeInteger(value)) maximum = Math.max(maximum, value);
  }
  return String(maximum + 1);
};
