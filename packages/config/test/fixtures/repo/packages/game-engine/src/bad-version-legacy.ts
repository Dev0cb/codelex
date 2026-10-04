const ENGINE_RULES_VERSION = 1;

export const current = (engineRulesVersion: number): boolean =>
  engineRulesVersion !== ENGINE_RULES_VERSION;
