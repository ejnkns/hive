const REFUSAL_PATTERNS = [
  "i cannot",
  "i'm unable",
  "i am unable",
  "i apologize",
  "sorry, i cannot",
  "i cannot answer",
  "i will not",
  "i'm sorry",
  "i am sorry",
  "i cannot complete",
  "i cannot provide",
  "i cannot generate",
  "i cannot fulfill",
]

export function detectRefusal(text: string): boolean {
  const lower = text.slice(0, 200).toLowerCase()
  return REFUSAL_PATTERNS.some((pattern) => lower.startsWith(pattern))
}
