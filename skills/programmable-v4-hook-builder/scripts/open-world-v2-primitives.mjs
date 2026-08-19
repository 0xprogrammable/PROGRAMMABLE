import crypto from "node:crypto";

export const MAX_PACKAGE_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_JSON_STRUCTURE_DEPTH = 128;
export const MAX_JSON_STRUCTURE_NODES = 250000;
export const STRICT_PACKAGE_JSON_OPTIONS = Object.freeze({
  maxSourceBytes: MAX_PACKAGE_FILE_BYTES,
  maxDepth: MAX_JSON_STRUCTURE_DEPTH,
  maxNodes: MAX_JSON_STRUCTURE_NODES,
  maxNumberCharacters: MAX_PACKAGE_FILE_BYTES
});

export class OpenWorldV2Error extends Error {
  constructor(code, message, { exitCode = 2, details = null, cause } = {}) {
    super(message, { cause });
    this.name = "OpenWorldV2Error";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      exitCode: this.exitCode,
      message: this.message,
      details: this.details
    };
  }
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortValue(value, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers.");
    if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) throw new TypeError(`Canonical JSON rejects ${typeof value}.`);
    return value;
  }
  if (seen.has(value)) throw new TypeError("Canonical JSON rejects cyclic values.");
  seen.add(value);
  const sorted = Array.isArray(value)
    ? value.map((entry) => sortValue(entry, seen))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key], seen)]));
  seen.delete(value);
  return sorted;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256Bytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Utf8(value) {
  if (typeof value !== "string") throw new TypeError("sha256Utf8 expects a string.");
  return sha256Bytes(Buffer.from(value, "utf8"));
}

export function utf8ByteLength(value) {
  if (typeof value !== "string") throw new TypeError("utf8ByteLength expects a string.");
  return Buffer.byteLength(value, "utf8");
}

function boundedJsonStringByteLength(value, remainingBytes) {
  let byteLength = 2;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c || unit === 0x08 || unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d) byteLength += 2;
    else if (unit <= 0x1f || (unit >= 0xd800 && unit <= 0xdfff && !(unit <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff))) byteLength += 6;
    else if (unit <= 0x7f) byteLength += 1;
    else if (unit <= 0x7ff) byteLength += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      byteLength += 4;
      index += 1;
    } else byteLength += 3;
    if (byteLength > remainingBytes) return byteLength;
  }
  return byteLength;
}

export function inspectJsonStructure(value, {
  maxDepth = MAX_JSON_STRUCTURE_DEPTH,
  maxNodes = MAX_JSON_STRUCTURE_NODES,
  maxBytes = MAX_PACKAGE_FILE_BYTES
} = {}) {
  const active = new Set();
  const stack = [{ value, depth: 0, exit: false }];
  let nodes = 0;
  let byteLength = 0;
  const failure = (code, message) => ({ ok: false, code, message, nodes, byteLength, maxDepth, maxNodes, maxBytes });
  const consumeBytes = (amount) => {
    byteLength += amount;
    return byteLength <= maxBytes;
  };
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.exit) {
      active.delete(frame.value);
      continue;
    }
    nodes += 1;
    if (nodes > maxNodes) return failure("JSON_STRUCTURE_NODE_LIMIT", "JSON input exceeds the bounded structural node limit.");
    if (frame.depth > maxDepth) return failure("JSON_STRUCTURE_DEPTH_LIMIT", "JSON input exceeds the bounded nesting-depth limit.");
    const current = frame.value;
    if (current === null) {
      if (!consumeBytes(4)) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      continue;
    }
    if (typeof current === "string") {
      if (!consumeBytes(boundedJsonStringByteLength(current, maxBytes - byteLength))) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      continue;
    }
    if (typeof current === "boolean") {
      if (!consumeBytes(current ? 4 : 5)) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return failure("JSON_VALUE_UNSUPPORTED", "JSON input contains a non-finite number.");
      if (!consumeBytes(String(Object.is(current, -0) ? 0 : current).length)) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      continue;
    }
    if (typeof current !== "object") return failure("JSON_VALUE_UNSUPPORTED", "JSON input contains a value that JSON cannot represent.");
    if (active.has(current)) return failure("JSON_STRUCTURE_CYCLE", "Direct JSON input contains a cycle.");
    const expectedPrototype = Array.isArray(current) ? Array.prototype : Object.prototype;
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== expectedPrototype && prototype !== null) return failure("JSON_OBJECT_PROTOTYPE_UNSUPPORTED", "Direct JSON input must use arrays or plain objects.");
    if (Object.getOwnPropertySymbols(current).some((symbol) => Object.prototype.propertyIsEnumerable.call(current, symbol))) return failure("JSON_VALUE_UNSUPPORTED", "JSON input contains an enumerable symbol key.");
    active.add(current);
    stack.push({ value: current, depth: frame.depth, exit: true });
    if (Array.isArray(current)) {
      if (current.length + nodes > maxNodes) return failure("JSON_STRUCTURE_NODE_LIMIT", "JSON input exceeds the bounded structural node limit.");
      if (!consumeBytes(2 + Math.max(0, current.length - 1))) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      const enumerableKeys = Object.keys(current);
      if (enumerableKeys.some((key) => !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= current.length)) return failure("JSON_VALUE_UNSUPPORTED", "JSON arrays cannot contain enumerable non-index properties.");
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor && !("value" in descriptor)) return failure("JSON_ACCESSOR_UNSUPPORTED", "Direct JSON input cannot contain accessor properties.");
        stack.push({ value: descriptor ? descriptor.value : null, depth: frame.depth + 1, exit: false });
      }
      continue;
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Object.keys(descriptors).filter((key) => descriptors[key].enumerable);
    if (keys.length + nodes > maxNodes) return failure("JSON_STRUCTURE_NODE_LIMIT", "JSON input exceeds the bounded structural node limit.");
    if (!consumeBytes(2 + Math.max(0, keys.length - 1))) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) return failure("JSON_ACCESSOR_UNSUPPORTED", "Direct JSON input cannot contain accessor properties.");
      if (!consumeBytes(boundedJsonStringByteLength(key, maxBytes - byteLength) + 1)) return failure("JSON_STRUCTURE_BYTE_LIMIT", "JSON input exceeds the bounded byte limit.");
      stack.push({ value: descriptor.value, depth: frame.depth + 1, exit: false });
    }
  }
  return { ok: true, code: null, message: null, nodes, byteLength, maxDepth, maxNodes, maxBytes };
}

export function strictJsonStructureFailure(error) {
  const mapping = {
    STRICT_JSON_DEPTH_LIMIT: "JSON_STRUCTURE_DEPTH_LIMIT",
    STRICT_JSON_NODE_LIMIT: "JSON_STRUCTURE_NODE_LIMIT",
    STRICT_JSON_SOURCE_LIMIT: "JSON_STRUCTURE_BYTE_LIMIT"
  };
  const code = mapping[error?.code];
  return code === undefined ? null : Object.freeze({ code });
}

export function decodeGrossQuoteWitnessV1(hookData, fallback = null) {
  const valid = [hookData?.mode === "bound", hookData?.contractId === "gross-quote-witness", hookData?.encoding === "abi-v2", hookData?.solidityType === "uint256", /^0x[0-9a-fA-F]{64}$/u.test(hookData?.example ?? "")].every(Boolean);
  return valid ? BigInt(hookData.example).toString() : fallback;
}

const V4_FEE_DENOMINATOR = 1_000_000n, V4_PLATFORM_RATE = 1_000n, V4_MINIMUM_GROSS = 1_000n;

export function exactStandardV4HookFeeV1(grossValue, selectedValue) {
  const gross = BigInt(grossValue), selected = BigInt(selectedValue), effective = selected < V4_PLATFORM_RATE ? V4_PLATFORM_RATE : selected;
  return gross * V4_PLATFORM_RATE / V4_FEE_DENOMINATOR + gross * (effective - V4_PLATFORM_RATE) / V4_FEE_DENOMINATOR;
}

export function standardV4FeeConservationMatchesV1({ baseAmount, feeAmount, expectedCurrency, inputCurrency, outputCurrency, observed }) {
  if (observed === null) return true;
  const base = BigInt(baseAmount), fee = BigInt(feeAmount);
  return expectedCurrency === inputCurrency ? base === BigInt(observed.input) : expectedCurrency === outputCurrency && base === BigInt(observed.output) + fee;
}

export function standardV4FeeAmountPolicyMatchesV1({ baseAmount, feeAmount, policy, feeScope }) {
  const base = BigInt(baseAmount), value = BigInt(feeAmount), hook = policy.kind === "hook" && policy.currencyRole === "programmable-quote-currency";
  const exact = policy.calculation !== "fixed-pips" || policy.ratePips === null ? value : hook ? exactStandardV4HookFeeV1(base, policy.ratePips) : (base * BigInt(policy.ratePips) + V4_FEE_DENOMINATOR - 1n) / V4_FEE_DENOMINATOR;
  const applicable = feeScope.applicability === "applicable" && hook;
  const minimum = applicable ? base * BigInt(feeScope.minimumPlatformRateHundredthsOfBip) / BigInt(feeScope.rateDenominator) : 0n;
  return value === exact && value >= minimum && !(applicable && base > 0n && base < BigInt(feeScope.minimumGrossQuoteUnits)) && value <= (base * BigInt(policy.maximumBps) + 9_999n) / 10_000n;
}

export function createStandardV4ModeFeeBindingV1({ inputCurrency, quoteCurrency, amountIn, amountOut, grossQuoteAmount, hookFeeAmount, selectedRateHundredthsOfBip } = {}) {
  const input = canonicalUintV1(amountIn, "amountIn"), output = canonicalUintV1(amountOut, "amountOut");
  const gross = canonicalUintV1(grossQuoteAmount, "grossQuoteAmount"), hookFee = canonicalUintV1(hookFeeAmount, "hookFeeAmount");
  const selected = canonicalUintV1(selectedRateHundredthsOfBip, "selectedRateHundredthsOfBip");
  if (gross < V4_MINIMUM_GROSS) throw new RangeError(`grossQuoteAmount is below the ${V4_MINIMUM_GROSS}-unit Programmable fee quantum`);
  if (selected > V4_FEE_DENOMINATOR) throw new RangeError("selectedRateHundredthsOfBip exceeds the fee denominator");
  if (hookFee !== exactStandardV4HookFeeV1(gross, selected)) throw new RangeError("hookFeeAmount does not equal the exact isolated trace fee at the selected rate");
  if (quoteCurrency === inputCurrency ? gross !== input : gross !== output + hookFee) throw new RangeError(quoteCurrency === inputCurrency ? "input-quote grossQuoteAmount must equal the observed amountIn" : "output-quote conservation requires grossQuoteAmount to equal observed amountOut plus hookFeeAmount");
  return Object.freeze({ grossQuoteAmount: gross.toString(), hookFeeAmount: hookFee.toString(), selectedRateHundredthsOfBip: selected.toString() });
}

function canonicalUintV1(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError(`${label} must be a canonical uint256 decimal string`);
  const parsed = BigInt(value);
  if (parsed >= 2n ** 256n) throw new RangeError(`${label} exceeds uint256`);
  return parsed;
}
