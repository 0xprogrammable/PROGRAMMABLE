export const DEEP_ORACLE_INITIAL_CARDINALITY_NEXT: 2;
export const DEEP_ORACLE_CARDINALITY_STEP: 16;
export const DEEP_ORACLE_CARDINALITY_TARGET: 192;
export const DEEP_ORACLE_GROWTH_EVENT_COUNT: number;

export type DeepOracleAutomationEvent = {
  vault: string;
  poolId: string;
  executor: string;
  previousCardinalityNext: number | bigint;
  newCardinalityNext: number | bigint;
};

export type DeepOracleHookEvent = {
  poolId: string;
  observationCardinalityNextOld: number | bigint;
  observationCardinalityNextNew: number | bigint;
};

export function validateDeepOracleGrowthSequence(input: {
  automationEvents: DeepOracleAutomationEvent[];
  hookEvents?: DeepOracleHookEvent[] | null;
  vault: string;
  poolId: string;
  executor: string;
}): void;
