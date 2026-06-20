/**
 * US-OBS-016 — truth-adapter moved to @roll/core (single read-side home).
 * Re-export for backward compat; new consumers import from @roll/core.
 */
export {
  TRUTH_SCHEMA_EPOCH_SEC,
  type TruthRunRow,
  cycleTruthFromRow,
  rowDelivered,
  storyTruthFromBacklog,
  evidenceTruth,
  outcomeToPanel,
} from "@roll/core";
