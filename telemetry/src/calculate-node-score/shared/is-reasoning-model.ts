export function isReasoningModel(modelName: string): boolean {
  return !!modelName.toLowerCase().match(/(r1|o1|o3|thinking|reasoning)/);
}
