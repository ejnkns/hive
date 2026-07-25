export function detectCompletion(content: string): boolean {
  return content.includes("REQUIREMENTS_COMPLETE");
}
