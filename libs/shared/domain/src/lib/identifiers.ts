export type ClaimId = string & { readonly __brand: 'ClaimId' };
export type LineId = string & { readonly __brand: 'LineId' };
export type RuleId = string & { readonly __brand: 'RuleId' };
export type PayerId = string & { readonly __brand: 'PayerId' };

export const createClaimId = (id: string): ClaimId => id as ClaimId;
export const createLineId = (id: string): LineId => id as LineId;
export const createRuleId = (id: string): RuleId => id as RuleId;
export const createPayerId = (id: string): PayerId => id as PayerId;
