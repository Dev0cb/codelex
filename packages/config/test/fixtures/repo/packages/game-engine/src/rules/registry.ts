// The registry is the one file allowed to tell rules versions apart (ADR-0014 §D1).
export function isDraft(engineRulesVersion: number): boolean {
  if (engineRulesVersion === 2) return true;
  switch (engineRulesVersion) {
    case 1:
      return false;
    default:
      return engineRulesVersion > 2;
  }
}
