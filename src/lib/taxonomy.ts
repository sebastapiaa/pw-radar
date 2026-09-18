/** Fixed vocabularies shared by server actions, pages and analytics. No data access. */

/** Why an account was marked dead. Stored in outcomes.reason; feeds Phase 7 fitted weights. */
export const DEAD_REASONS = ["dead_company", "wrong_entity", "competitor", "bad_fit", "already_covered", "other"] as const;
export type DeadReason = (typeof DEAD_REASONS)[number];

export const DEAD_LABELS: Record<DeadReason, string> = {
  dead_company: "Company is dead or gone",
  wrong_entity: "Wrong entity (branch, subsidiary, namesake)",
  competitor: "Competitor or provider",
  bad_fit: "Bad fit",
  already_covered: "Already covered (client, partner, in progress elsewhere)",
  other: "Other (note required)",
};
