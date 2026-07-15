const REFERENCE_MAX_TOKENS = 128_000;

export function computeContextWindowScore(maxContextTokens: number): number {
  return Math.min(
    100,
    (Math.log(maxContextTokens) / Math.log(REFERENCE_MAX_TOKENS)) * 100
  );
}
