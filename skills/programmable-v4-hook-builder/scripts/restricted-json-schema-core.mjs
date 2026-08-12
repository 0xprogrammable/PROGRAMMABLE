import {
  boundedEntries,
  inspectSchemaDefinition,
  resolveLocalReference,
  schemaRuleShapeIsValid
} from "./restricted-json-schema-definition-core.mjs";
import { canonicalJson, isObject, sameValue } from "./submission-value-core.mjs";

const MAX_INSTANCE_DEPTH = 64;
const MAX_INSTANCE_NODES = 32768;
const MAX_VALIDATION_STEPS = 131072;
const MAX_SCHEMA_FINDINGS = 128;
const MAX_PATTERN_INPUT_LENGTH = 4096;
const structuralSchemaFinding = Symbol("structuralSchemaFinding");


export function validateAgainstSchema(value, schema) {
  const findings = [];
  let findingsCapped = false;

  function add(code, path, message, { structural = false } = {}) {
    if (findingsCapped) return;
    if (findings.length >= MAX_SCHEMA_FINDINGS - 1) {
      const finding = {
        severity: "blocker",
        code: "SCHEMA_FINDING_LIMIT",
        path: "$",
        message: `Schema validation stopped after ${MAX_SCHEMA_FINDINGS - 1} findings.`,
        remediation: "Fix the reported structural errors before running compatibility review again."
      };
      Object.defineProperty(finding, structuralSchemaFinding, { value: true });
      findings.push(finding);
      findingsCapped = true;
      return;
    }
    const finding = {
      severity: "blocker",
      code,
      path,
      message,
      remediation: "Make the submission match submission.schema.json before compatibility review."
    };
    if (structural) Object.defineProperty(finding, structuralSchemaFinding, { value: true });
    findings.push(finding);
  }

  const addStructural = (code, path, message) => add(code, path, message, { structural: true });
  const schemaInspection = inspectSchemaDefinition(schema, addStructural);
  if (!schemaInspection.valid) return findings;
  if (!inspectInstance(value, addStructural) || findingsCapped) return findings;

  let validationSteps = 0;
  let validationAborted = false;
  function check(node, rule, instancePath, emit = add) {
    if (findingsCapped || validationAborted) return;
    validationSteps += 1;
    if (validationSteps > MAX_VALIDATION_STEPS) {
      validationAborted = true;
      addStructural("SCHEMA_VALIDATION_STEP_LIMIT", instancePath, `Schema validation exceeded ${MAX_VALIDATION_STEPS} deterministic steps.`);
      return;
    }
    if (rule === true) return;
    if (rule === false) {
      emit("SCHEMA_FALSE", instancePath, "Value is forbidden by the schema.");
      return;
    }
    if (!isObject(rule)) {
      emit("SCHEMA_RULE_INVALID", instancePath, "Schema rules must be JSON objects or booleans.", { structural: true });
      return;
    }
    if (!schemaRuleShapeIsValid(rule)) {
      emit("SCHEMA_KEYWORD_INVALID", instancePath, "Schema structure keywords must use the supported JSON shapes.", { structural: true });
      return;
    }

    const branchMatches = (branch) => {
      const captured = [];
      check(node, branch, instancePath, (...args) => captured.push(args));
      return !validationAborted && captured.length === 0;
    };
    for (const branch of rule.allOf ?? []) {
      check(node, branch, instancePath, emit);
      if (validationAborted) return;
    }
    if (Array.isArray(rule.anyOf) && !rule.anyOf.some((branch) => branchMatches(branch))) {
      if (validationAborted) return;
      emit("SCHEMA_ANY_OF", instancePath, "Value must match at least one schema option.");
    }
    if (Array.isArray(rule.oneOf)) {
      let matches = 0;
      for (const branch of rule.oneOf) {
        if (branchMatches(branch)) matches += 1;
        if (validationAborted) return;
      }
      if (matches !== 1) emit("SCHEMA_ONE_OF", instancePath, "Value must match exactly one schema option.");
    }
    if (rule.not !== undefined) {
      const forbiddenBranchMatches = branchMatches(rule.not);
      if (validationAborted) return;
      if (forbiddenBranchMatches) emit("SCHEMA_NOT", instancePath, "Value matches a forbidden schema option.");
    }
    if (rule.if !== undefined) {
      const conditionMatches = branchMatches(rule.if);
      if (validationAborted) return;
      if (conditionMatches && rule.then !== undefined) check(node, rule.then, instancePath, emit);
      if (!conditionMatches && rule.else !== undefined) check(node, rule.else, instancePath, emit);
      if (validationAborted) return;
    }
    if (rule.$ref !== undefined) {
      const target = resolveLocalReference(schema, rule.$ref);
      if (!target && target !== false) {
        emit("SCHEMA_REFERENCE_INVALID", instancePath, `Schema reference ${rule.$ref} could not be resolved.`, { structural: true });
      } else {
        check(node, target, instancePath, emit);
        if (validationAborted) return;
      }
    }

    if ("const" in rule && !sameValue(node, rule.const)) emit("SCHEMA_CONST", instancePath, `Expected ${JSON.stringify(rule.const)}.`);
    if (Array.isArray(rule.enum) && !rule.enum.some((entry) => sameValue(node, entry))) emit("SCHEMA_ENUM", instancePath, "Value is not one of the allowed options.");

    const allowedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(node, type))) {
      emit("SCHEMA_TYPE", instancePath, `Expected ${allowedTypes.join(" or ")}.`, {
        structural: instancePath === "$" || allowedTypes.some((type) => type === "object" || type === "array")
      });
      return;
    }

    if (typeof node === "string") {
      const characterLength = [...node].length;
      if (rule.minLength !== undefined && characterLength < rule.minLength) emit("SCHEMA_MIN_LENGTH", instancePath, `Text must be at least ${rule.minLength} characters.`);
      if (rule.maxLength !== undefined && characterLength > rule.maxLength) emit("SCHEMA_MAX_LENGTH", instancePath, `Text must be at most ${rule.maxLength} characters.`);
      if (rule.pattern !== undefined) {
        if (node.length > MAX_PATTERN_INPUT_LENGTH) {
          emit("SCHEMA_PATTERN_INPUT_LIMIT", instancePath, `Pattern validation accepts at most ${MAX_PATTERN_INPUT_LENGTH} characters.`, { structural: true });
        } else if (!schemaInspection.patterns.get(rule)?.test(node)) {
          emit("SCHEMA_PATTERN", instancePath, "Text does not match the required format.");
        }
      }
      if (rule.format === "uri") {
        try {
          const url = new URL(node);
          if (!url.protocol) emit("SCHEMA_URI", instancePath, "Expected an absolute URI.");
        } catch {
          emit("SCHEMA_URI", instancePath, "Expected an absolute URI.");
        }
      } else if (rule.format === "date-time" && !validJsonSchemaDateTime(node)) {
        emit("SCHEMA_DATE_TIME", instancePath, "Expected a valid RFC 3339 date-time.");
      }
    }

    if (typeof node === "number" && Number.isFinite(node)) {
      if (rule.minimum !== undefined && node < rule.minimum) emit("SCHEMA_MINIMUM", instancePath, `Value must be at least ${rule.minimum}.`);
      if (rule.maximum !== undefined && node > rule.maximum) emit("SCHEMA_MAXIMUM", instancePath, `Value must be at most ${rule.maximum}.`);
      if (rule.exclusiveMinimum !== undefined && node <= rule.exclusiveMinimum) emit("SCHEMA_EXCLUSIVE_MINIMUM", instancePath, `Value must be greater than ${rule.exclusiveMinimum}.`);
      if (rule.exclusiveMaximum !== undefined && node >= rule.exclusiveMaximum) emit("SCHEMA_EXCLUSIVE_MAXIMUM", instancePath, `Value must be less than ${rule.exclusiveMaximum}.`);
      if (rule.multipleOf !== undefined && !isJsonSchemaMultipleOf(node, rule.multipleOf)) emit("SCHEMA_MULTIPLE_OF", instancePath, `Value must be a multiple of ${rule.multipleOf}.`);
    }

    if (Array.isArray(node)) {
      if (rule.minItems !== undefined && node.length < rule.minItems) emit("SCHEMA_MIN_ITEMS", instancePath, `Expected at least ${rule.minItems} items.`);
      if (rule.maxItems !== undefined && node.length > rule.maxItems) emit("SCHEMA_MAX_ITEMS", instancePath, `Expected at most ${rule.maxItems} items.`);
      if (rule.uniqueItems && new Set(node.map(canonicalJson)).size !== node.length) emit("SCHEMA_UNIQUE_ITEMS", instancePath, "Array items must be unique.");
      const prefixLength = Array.isArray(rule.prefixItems) ? rule.prefixItems.length : 0;
      for (let index = 0; index < Math.min(prefixLength, node.length); index += 1) check(node[index], rule.prefixItems[index], `${instancePath}[${index}]`, emit);
      if (rule.items !== undefined) for (let index = prefixLength; index < node.length; index += 1) check(node[index], rule.items, `${instancePath}[${index}]`, emit);
      if (rule.contains !== undefined) {
        const matchCount = node.filter((entry, index) => {
          const captured = [];
          check(entry, rule.contains, `${instancePath}[${index}]`, (...args) => captured.push(args));
          return captured.length === 0;
        }).length;
        const minimum = rule.minContains ?? 1;
        if (matchCount < minimum) emit("SCHEMA_MIN_CONTAINS", instancePath, `Expected at least ${minimum} matching array items.`);
        if (rule.maxContains !== undefined && matchCount > rule.maxContains) emit("SCHEMA_MAX_CONTAINS", instancePath, `Expected at most ${rule.maxContains} matching array items.`);
      }
    }

    if (isObject(node)) {
      const properties = rule.properties ?? {};
      const keys = Object.keys(node);
      if (rule.minProperties !== undefined && keys.length < rule.minProperties) emit("SCHEMA_MIN_PROPERTIES", instancePath, `Expected at least ${rule.minProperties} properties.`);
      if (rule.maxProperties !== undefined && keys.length > rule.maxProperties) emit("SCHEMA_MAX_PROPERTIES", instancePath, `Expected at most ${rule.maxProperties} properties.`);
      for (const required of rule.required ?? []) {
        if (!Object.hasOwn(node, required)) emit("SCHEMA_REQUIRED", `${instancePath}.${required}`, "Required field is missing.", { structural: instancePath === "$" });
      }
      for (const key of keys) {
        if (findingsCapped) break;
        if (rule.propertyNames !== undefined) check(key, rule.propertyNames, `${instancePath}.${key}`, emit);
        if (Object.hasOwn(properties, key)) continue;
        if (rule.additionalProperties === false) emit("SCHEMA_ADDITIONAL_PROPERTY", `${instancePath}.${key}`, "Unexpected field.", { structural: true });
        else if (rule.additionalProperties !== undefined && rule.additionalProperties !== true) check(node[key], rule.additionalProperties, `${instancePath}.${key}`, emit);
      }
      for (const [key, childRule] of Object.entries(properties)) {
        if (findingsCapped) break;
        if (Object.hasOwn(node, key)) check(node[key], childRule, `${instancePath}.${key}`, emit);
      }
    }
  }

  check(value, schema, "$");
  return findings;
}


function inspectInstance(value, add) {
  const seen = new WeakSet();
  const active = new WeakSet();
  const stack = [{ node: value, path: "$", depth: 0, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.leaving) {
      active.delete(current.node);
      continue;
    }
    if (current.depth > MAX_INSTANCE_DEPTH) {
      add("SCHEMA_INSTANCE_DEPTH_LIMIT", current.path, `The submission exceeds the maximum depth of ${MAX_INSTANCE_DEPTH}.`);
      return false;
    }
    nodes += 1;
    if (nodes > MAX_INSTANCE_NODES) {
      add("SCHEMA_INSTANCE_NODE_LIMIT", current.path, `The submission exceeds the maximum of ${MAX_INSTANCE_NODES} values.`);
      return false;
    }
    if (!current.node || typeof current.node !== "object") continue;
    if (active.has(current.node)) {
      add("SCHEMA_INSTANCE_CYCLE", current.path, "The submission contains an object cycle and cannot be validated as JSON.");
      return false;
    }
    if (seen.has(current.node)) continue;

    seen.add(current.node);
    active.add(current.node);
    stack.push({ ...current, leaving: true });
    const entries = boundedEntries(current.node, MAX_INSTANCE_NODES);
    if (!entries) {
      add("SCHEMA_INSTANCE_NODE_LIMIT", current.path, `The submission exceeds the maximum of ${MAX_INSTANCE_NODES} values.`);
      return false;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({
        node: child,
        path: Array.isArray(current.node) ? `${current.path}[${key}]` : `${current.path}.${key}`,
        depth: current.depth + 1,
        leaving: false
      });
    }
  }
  return true;
}

export function schemaFindingStopsSemanticReview(finding) {
  return finding?.[structuralSchemaFinding] === true;
}

function validJsonSchemaDateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || day < 1 || day > daysInUtcMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  return Number.isFinite(Date.parse(value));
}

function daysInUtcMonth(year, month) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isJsonSchemaMultipleOf(value, divisor) {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) return false;
  const valueParts = finiteNumberDecimalParts(value);
  const divisorParts = finiteNumberDecimalParts(divisor);
  if (!valueParts || !divisorParts || divisorParts.coefficient === 0n) return false;

  const scaleDelta = divisorParts.scale - valueParts.scale;
  const numerator = scaleDelta >= 0
    ? valueParts.coefficient * (10n ** BigInt(scaleDelta))
    : valueParts.coefficient;
  const denominator = scaleDelta >= 0
    ? divisorParts.coefficient
    : divisorParts.coefficient * (10n ** BigInt(-scaleDelta));
  return numerator % denominator === 0n;
}

function finiteNumberDecimalParts(value) {
  if (!Number.isFinite(value)) return null;
  const [mantissa, exponentText = "0"] = Math.abs(value).toString().toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return null;
  const dotIndex = mantissa.indexOf(".");
  const fractionLength = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
  const digits = mantissa.replace(".", "");
  if (!/^[0-9]+$/u.test(digits)) return null;
  return {
    coefficient: BigInt(digits),
    scale: fractionLength - exponent
  };
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}
