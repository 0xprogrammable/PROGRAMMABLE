import { canonicalizeJson } from "./canonical-json.mjs";
import {
  BEHAVIOR_SCENARIO_INPUTS_SCHEMA,
  MAX_BEHAVIOR_SCENARIO_BYTES,
  MAX_BEHAVIOR_SCENARIO_CALLDATA_BYTES,
  MAX_BEHAVIOR_SCENARIO_HOOK_DATA_BYTES,
  MAX_BEHAVIOR_SCENARIO_STEPS,
} from "./constants.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const DECIMAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const LOWER_EVEN_HEX = /^0x(?:[0-9a-f]{2})*$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const PHASES = new Set(["seed", "swap", "liquidity", "claim", "custom-accounting"]);
const ACTORS = new Set(["launch-wallet", "secondary-user", "unauthorized-claimer"]);

function canonicalUint256(value, label) {
  if (typeof value !== "string" || !DECIMAL_UINT.test(value)
    || BigInt(value) > MAX_UINT256) {
    throw new TypeError(`${label} must be a canonical uint256 decimal string`);
  }
  return value;
}

function canonicalBytes(value, maximumBytes, label) {
  if (typeof value !== "string" || !LOWER_EVEN_HEX.test(value)
    || (value.length - 2) / 2 > maximumBytes) {
    throw new TypeError(`${label} must be lowercase even hex at most ${maximumBytes} bytes`);
  }
  return value;
}

function canonicalTarget(value, preparedTargetIds, label) {
  if (value?.kind === "prepared-target") {
    assertExactKeys(value, ["kind", "targetId"], label);
    if (typeof value.targetId !== "string" || !preparedTargetIds.has(value.targetId)) {
      throw new TypeError(`${label}.targetId must reference an exact prepared target`);
    }
    return Object.freeze({ kind: "prepared-target", targetId: value.targetId });
  }
  if (value?.kind === "chain-binding") {
    assertExactKeys(value, ["kind", "binding"], label);
    if (value.binding !== "poolManager") {
      throw new TypeError(`${label}.binding must be poolManager`);
    }
    return Object.freeze({ kind: "chain-binding", binding: "poolManager" });
  }
  if (value?.kind === "runner-harness") {
    assertExactKeys(value, ["kind", "harness"], label);
    if (value.harness !== "v4-actions-v1") {
      throw new TypeError(`${label}.harness must be v4-actions-v1`);
    }
    return Object.freeze({ kind: "runner-harness", harness: "v4-actions-v1" });
  }
  throw new TypeError(`${label} is not a supported exact scenario target`);
}

export function validateBehaviorScenarioInputs(value, targets) {
  assertExactKeys(value, ["schemaVersion", "steps"], "behaviorScenarioInputs");
  if (value.schemaVersion !== BEHAVIOR_SCENARIO_INPUTS_SCHEMA
    || !Array.isArray(value.steps)
    || value.steps.length < 1
    || value.steps.length > MAX_BEHAVIOR_SCENARIO_STEPS) {
    throw new TypeError("behaviorScenarioInputs must contain 1 to 128 ordered steps");
  }
  const preparedTargetIds = new Set(targets.map(({ targetId }) => targetId));
  const stepIds = new Set();
  let aggregateBytes = 0;
  const steps = value.steps.map((step, index) => {
    const label = `behaviorScenarioInputs.steps[${index}]`;
    assertExactKeys(step, [
      "stepId",
      "phase",
      "actor",
      "target",
      "valueWei",
      "calldata",
      "hookData",
    ], label);
    if (typeof step.stepId !== "string" || !STEP_ID.test(step.stepId)
      || stepIds.has(step.stepId)) {
      throw new TypeError(`${label}.stepId must be a unique bounded ASCII identifier`);
    }
    stepIds.add(step.stepId);
    if (!PHASES.has(step.phase)) throw new TypeError(`${label}.phase is invalid`);
    if (!ACTORS.has(step.actor)) throw new TypeError(`${label}.actor is invalid`);
    const calldata = canonicalBytes(
      step.calldata,
      MAX_BEHAVIOR_SCENARIO_CALLDATA_BYTES,
      `${label}.calldata`,
    );
    const hookData = canonicalBytes(
      step.hookData,
      MAX_BEHAVIOR_SCENARIO_HOOK_DATA_BYTES,
      `${label}.hookData`,
    );
    aggregateBytes += (calldata.length + hookData.length - 4) / 2;
    return Object.freeze({
      stepId: step.stepId,
      phase: step.phase,
      actor: step.actor,
      target: canonicalTarget(step.target, preparedTargetIds, `${label}.target`),
      valueWei: canonicalUint256(step.valueWei, `${label}.valueWei`),
      calldata,
      hookData,
    });
  });
  if (aggregateBytes > MAX_BEHAVIOR_SCENARIO_BYTES) {
    throw new TypeError(
      `behaviorScenarioInputs calldata and hookData exceed ${MAX_BEHAVIOR_SCENARIO_BYTES} bytes`,
    );
  }
  return Object.freeze({
    schemaVersion: BEHAVIOR_SCENARIO_INPUTS_SCHEMA,
    steps: Object.freeze(steps),
  });
}

export function hashBehaviorScenarioInputs(value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(BEHAVIOR_SCENARIO_INPUTS_SCHEMA, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}
