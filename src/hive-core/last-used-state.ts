/** @public */

let lastProvider: string | null = null;
let lastModel: string | null = null;

export function setLastUsed(
  provider: string | null,
  model: string | null
): void {
  lastProvider = provider;
  lastModel = model;
}

export function getLastUsed(): {
  provider: string | null;
  model: string | null;
} {
  return { provider: lastProvider, model: lastModel };
}
