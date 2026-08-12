import { ACTIVATION_TRUE_FIELDS, LAYERS, MAX_UINT256 } from "./open-world-security-constants.mjs";

export function requireTrue(merged, profile, field, add, { code, message, remediation }) {
  const signal = merged[profile][field];
  if (signal.state === "known" && signal.value === true) return;
  add("CHANGES_REQUIRED", code, `$.layers.*.${profile}.${field}`, message, remediation);
}

export function requireTrueWithRedesign(input, merged, profile, field, add, { code, message, remediation }) {
  const signal = merged[profile][field];
  if (signal.state === "known" && signal.value === true) return;
  add(anyValue(input, profile, field, false) ? "SAFE_REDESIGN" : "CHANGES_REQUIRED", code, `$.layers.*.${profile}.${field}`, message, remediation);
}

export function requireFalse(merged, profile, field, add, { code, message, remediation }) {
  const signal = merged[profile][field];
  if (signal.state === "known" && signal.value === false) return;
  add("CHANGES_REQUIRED", code, `$.layers.*.${profile}.${field}`, message, remediation);
}

export function requireKnownBoolean(merged, profile, field, add, { code, message, remediation }) {
  const signal = merged[profile][field];
  if (signal.state === "known" && typeof signal.value === "boolean") return;
  add("CHANGES_REQUIRED", code, `$.layers.*.${profile}.${field}`, message, remediation);
}

export function requireOneOf(merged, profile, field, accepted, add, { code, message, remediation }) {
  const signal = merged[profile][field];
  if (signal.state === "known" && accepted.includes(signal.value)) return;
  add("CHANGES_REQUIRED", code, `$.layers.*.${profile}.${field}`, message, remediation);
}

export function profileActive(input, profile) {
  if (anyValue(input, profile, "used", true)) return true;
  if ((ACTIVATION_TRUE_FIELDS[profile] ?? []).some((field) => anyValue(input, profile, field, true))) return true;
  if (profile === "privilegedValue" && observedValues(input, profile, "authorityModel").some((value) => !["none", "immutable-rules"].includes(value))) return true;
  if (profile === "randomness" && observedValues(input, profile, "source").some((value) => value !== "none")) return true;
  const usedValues = observedValues(input, profile, "used");
  if (usedValues.length > 0) return false;
  for (const layer of LAYERS) {
    const profileValue = input?.layers?.[layer]?.[profile];
    if (!isObject(profileValue)) continue;
    if (Object.entries(profileValue).some(([field, value]) => field !== "used" && field !== "evidenceRefs" && value !== null)) return true;
  }
  return false;
}

export function anyValue(input, profile, field, expected) {
  return LAYERS.some((layer) => hasLayerValue(input, layer, profile, field, expected));
}

export function hasLayerValue(input, layer, profile, field, expected) {
  const profileValue = input?.layers?.[layer]?.[profile];
  return isObject(profileValue) && hasOwn(profileValue, field) && Object.is(profileValue[field], expected);
}

export function observedValues(input, profile, field) {
  const values = [];
  for (const layer of LAYERS) {
    const profileValue = input?.layers?.[layer]?.[profile];
    if (!isObject(profileValue) || !hasOwn(profileValue, field) || profileValue[field] === null) continue;
    if (!values.some((value) => deepEqual(value, profileValue[field]))) values.push(profileValue[field]);
  }
  return values;
}

export function knownValue(merged, profile, field) {
  const signal = merged?.[profile]?.[field];
  return signal?.state === "known" ? signal.value : undefined;
}

export function mergeObservations(observations, unknownLayers) {
  const distinct = [];
  for (const observation of observations) {
    if (!distinct.some((value) => deepEqual(value, observation.value))) distinct.push(observation.value);
  }
  if (distinct.length === 0) {
    return { state: "unknown", observations, unknownLayers };
  }
  if (distinct.length === 1) {
    return { state: "known", value: distinct[0], observations, unknownLayers };
  }
  return { state: "conflict", values: distinct, observations, unknownLayers };
}

export function validateEvidenceRefs(value, path, issue) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue("OPEN_WORLD_EVIDENCE_REFS_TYPE", path, "evidenceRefs must be an array.");
    return;
  }
  if (new Set(value).size !== value.length) {
    issue("OPEN_WORLD_EVIDENCE_REFS_SET", path, "evidenceRefs must not contain duplicate entries.");
  }
  for (const [index, entry] of value.entries()) {
    if (!nonEmptyText(entry)) {
      issue("OPEN_WORLD_EVIDENCE_REF", `${path}[${index}]`, "Each evidence reference must be a non-empty string.");
    }
  }
}

export function jsonTreeIsValid(value) {
  const seen = new WeakSet();
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node === "string" || typeof node === "boolean") continue;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return false;
      continue;
    }
    if (typeof node !== "object" || seen.has(node)) return false;
    seen.add(node);
    stack.push(...(Array.isArray(node) ? node : Object.values(node)));
  }
  return true;
}

export function rejectUnknownKeys(value, allowed, path, issue) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue("OPEN_WORLD_UNKNOWN_FIELD", `${path}.${key}`, `Unknown field ${key}.`);
  }
}


export function isUintString(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 79) return false;
  return BigInt(value) <= MAX_UINT256;
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function nonEmptyText(value) {
  return typeof value === "string" && /\S/.test(value);
}

export function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))].sort();
}

export function uniqueObjects(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
