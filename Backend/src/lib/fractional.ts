import { generateKeyBetween as rawGenerateKeyBetween } from 'fractional-indexing';

/**
 * Generate a fractional position between two adjacent items.
 *
 * Examples:
 * - Start of list: generatePosition(null, "a0") -> returns string before "a0"
 * - End of list: generatePosition("a0", null) -> returns string after "a0"
 * - Between two: generatePosition("a0", "a1") -> returns e.g. "a0V"
 * - Empty list: generatePosition(null, null) -> returns base position "a0"
 */
export const generatePosition = (
  a: string | null | undefined,
  b: string | null | undefined
): string => {
  return rawGenerateKeyBetween(a ?? null, b ?? null);
};
