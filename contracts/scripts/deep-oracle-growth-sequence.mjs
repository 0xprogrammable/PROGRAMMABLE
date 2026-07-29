export const DEEP_ORACLE_INITIAL_CARDINALITY_NEXT = 2;
export const DEEP_ORACLE_CARDINALITY_STEP = 16;
export const DEEP_ORACLE_CARDINALITY_TARGET = 192;
export const DEEP_ORACLE_GROWTH_EVENT_COUNT = Math.ceil(
  (DEEP_ORACLE_CARDINALITY_TARGET - DEEP_ORACLE_INITIAL_CARDINALITY_NEXT) /
    DEEP_ORACLE_CARDINALITY_STEP,
);

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function validateDeepOracleGrowthSequence({
  automationEvents,
  hookEvents = null,
  vault,
  poolId,
  executor,
}) {
  if (
    !Array.isArray(automationEvents) ||
    automationEvents.length !== DEEP_ORACLE_GROWTH_EVENT_COUNT
  ) {
    throw new Error(
      `Deep oracle growth requires exactly ${DEEP_ORACLE_GROWTH_EVENT_COUNT} Automation events`,
    );
  }
  if (
    hookEvents !== null &&
    (!Array.isArray(hookEvents) ||
      hookEvents.length !== DEEP_ORACLE_GROWTH_EVENT_COUNT)
  ) {
    throw new Error(
      `Deep oracle growth requires exactly ${DEEP_ORACLE_GROWTH_EVENT_COUNT} hook events`,
    );
  }

  let expectedPrevious = DEEP_ORACLE_INITIAL_CARDINALITY_NEXT;
  for (let index = 0; index < DEEP_ORACLE_GROWTH_EVENT_COUNT; index += 1) {
    const automationEvent = automationEvents[index];
    const expectedNext = Math.min(
      DEEP_ORACLE_CARDINALITY_TARGET,
      expectedPrevious + DEEP_ORACLE_CARDINALITY_STEP,
    );
    if (
      !sameAddress(automationEvent?.vault, vault) ||
      automationEvent?.poolId !== poolId ||
      !sameAddress(automationEvent?.executor, executor) ||
      Number(automationEvent?.previousCardinalityNext) !== expectedPrevious ||
      Number(automationEvent?.newCardinalityNext) !== expectedNext
    ) {
      throw new Error(
        `Deep oracle Automation event ${index} is outside the canonical 2 -> 192 sequence`,
      );
    }

    if (hookEvents !== null) {
      const hookEvent = hookEvents[index];
      if (
        hookEvent?.poolId !== poolId ||
        Number(hookEvent?.observationCardinalityNextOld) !== expectedPrevious ||
        Number(hookEvent?.observationCardinalityNextNew) !== expectedNext
      ) {
        throw new Error(
          `Deep oracle hook event ${index} is outside the canonical 2 -> 192 sequence`,
        );
      }
    }
    expectedPrevious = expectedNext;
  }

  if (expectedPrevious !== DEEP_ORACLE_CARDINALITY_TARGET) {
    throw new Error("Deep oracle growth did not reach cardinalityNext 192");
  }
}
