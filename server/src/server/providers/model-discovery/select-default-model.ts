export function selectDefaultModel(
  fetchedModels: string[],
  fallbackDefault: string,
  preferences?: string[]
): string {
  if (!preferences || preferences.length === 0) return fallbackDefault;

  for (const preferred of preferences) {
    if (fetchedModels.includes(preferred)) {
      return preferred;
    }
  }

  if (fetchedModels.includes(fallbackDefault)) {
    return fallbackDefault;
  }

  if (fetchedModels.length === 0) {
    return fallbackDefault;
  }

  let bestModel = fetchedModels[0];
  let highestScore = -Infinity;

  for (const m of fetchedModels) {
    const lower = m.toLowerCase();
    let score = 0;

    if (
      ["guard", "embed", "moderation", "ocr", "translate", "vision"].some(
        (kw) => lower.includes(kw)
      )
    ) {
      score -= 1000;
    }
    if (["120b", "405b"].some((kw) => lower.includes(kw))) score += 100;
    if (lower.includes("70b")) score += 80;
    if (lower.includes("-free")) score += 50;
    if (
      ["large", "pro", "instruct", "r1", "plus"].some((kw) =>
        lower.includes(kw)
      )
    )
      score += 20;
    if (
      ["8b", "7b", "3b", "1b", "mini", "small", "flash", "lite"].some((kw) =>
        lower.includes(kw)
      )
    )
      score -= 40;

    if (score > highestScore) {
      highestScore = score;
      bestModel = m;
    }
  }
  return bestModel;
}
