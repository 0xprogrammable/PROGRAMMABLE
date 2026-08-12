import { canonicalJson, isObject } from "./open-world-v2-primitives.mjs";
import {
  inspectSchemaKeywords,
  matchesJsonType,
  resolveLocalSchemaRef
} from "./open-world-v2-extension-schema-inspection.mjs";

const MAX_EXTENSION_VALIDATION_STEPS = 50000;

export function validateExtensionInstance(instance, schema, { trustedSchema = false } = {}) {
  const issues = inspectSchemaKeywords(schema, { trustedSchema });
  if (issues.length > 0) return issues;
  let steps = 0;
  let fatalIssue = null;
  const add = (code, instancePath, message) => {
    if (issues.length < 128) issues.push({ code, path: instancePath, message });
  };
  const addFatal = (code, instancePath, message) => {
    if (fatalIssue === null) fatalIssue = { code, path: instancePath, message };
  };
  const consumeValidationBudget = (instancePath) => {
    if (fatalIssue !== null) return false;
    steps += 1;
    if (steps > MAX_EXTENSION_VALIDATION_STEPS) {
      addFatal("VALIDATION_STEP_LIMIT", instancePath, `Extension validation exceeded ${MAX_EXTENSION_VALIDATION_STEPS.toLocaleString("en-US")} deterministic steps.`);
      return false;
    }
    return true;
  };

  function check(value, rule, instancePath, depth = 0) {
    if (!consumeValidationBudget(instancePath)) return;
    if (depth > 64) {
      addFatal("VALIDATION_DEPTH_LIMIT", instancePath, "Extension validation exceeded depth 64.");
      return;
    }
    if (rule === true) return;
    if (rule === false) {
      add("FALSE_SCHEMA", instancePath, "Value is forbidden by the bound extension schema.");
      return;
    }
    if (!isObject(rule)) {
      add("SCHEMA_RULE_INVALID", instancePath, "Extension schema rules must be objects or booleans.");
      return;
    }
    if (rule.$ref !== undefined) {
      const target = resolveLocalSchemaRef(schema, rule.$ref);
      if (target === null) addFatal("SCHEMA_REFERENCE_INVALID", instancePath, "Only resolvable local extension-schema references are supported.");
      else check(value, target, instancePath, depth + 1);
      if (fatalIssue !== null) return;
    }
    const branchIssuesFor = (candidateValue, branch, candidatePath, candidateDepth) => {
      const before = issues.length;
      check(candidateValue, branch, candidatePath, candidateDepth + 1);
      const result = issues.splice(before);
      return result;
    };
    const branchIssues = (branch) => branchIssuesFor(value, branch, instancePath, depth);
    if (Array.isArray(rule.allOf)) {
      for (const branch of rule.allOf) {
        check(value, branch, instancePath, depth + 1);
        if (fatalIssue !== null) return;
      }
    }
    if (Array.isArray(rule.anyOf)) {
      const candidates = [];
      for (const branch of rule.anyOf) {
        candidates.push(branchIssues(branch));
        if (fatalIssue !== null) return;
      }
      if (!candidates.some((candidate) => candidate.length === 0)) add("ANY_OF", instancePath, "Value matches no anyOf branch.");
    }
    if (Array.isArray(rule.oneOf)) {
      const candidates = [];
      for (const branch of rule.oneOf) {
        candidates.push(branchIssues(branch));
        if (fatalIssue !== null) return;
      }
      if (candidates.filter((candidate) => candidate.length === 0).length !== 1) add("ONE_OF", instancePath, "Value must match exactly one oneOf branch.");
    }
    if (rule.not !== undefined) {
      const notIssues = branchIssues(rule.not);
      if (fatalIssue !== null) return;
      if (notIssues.length === 0) add("NOT", instancePath, "Value matches a forbidden schema branch.");
    }
    if (rule.if !== undefined) {
      const conditionMatches = branchIssues(rule.if).length === 0;
      if (fatalIssue !== null) return;
      if (conditionMatches && rule.then !== undefined) check(value, rule.then, instancePath, depth + 1);
      if (!conditionMatches && rule.else !== undefined) check(value, rule.else, instancePath, depth + 1);
      if (fatalIssue !== null) return;
    }
    if (rule.const !== undefined && canonicalJson(value) !== canonicalJson(rule.const)) add("CONST", instancePath, "Value differs from the schema constant.");
    if (Array.isArray(rule.enum)) {
      const canonicalValue = canonicalJson(value);
      let enumMatch = false;
      for (const [index, entry] of rule.enum.entries()) {
        if (!consumeValidationBudget(`${instancePath}.<enum:${index}>`)) return;
        if (canonicalJson(entry) === canonicalValue) {
          enumMatch = true;
          break;
        }
      }
      if (!enumMatch) add("ENUM", instancePath, "Value is outside the schema enum.");
    }
    const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    if (types.length > 0) {
      let typeMatch = false;
      for (const type of types) {
        if (!consumeValidationBudget(instancePath)) return;
        if (matchesJsonType(value, type)) {
          typeMatch = true;
          break;
        }
      }
      if (!typeMatch) {
        add("TYPE", instancePath, `Expected ${types.join(" or ")}.`);
        return;
      }
    }
    if (typeof value === "string") {
      if (Number.isInteger(rule.minLength) && [...value].length < rule.minLength) add("MIN_LENGTH", instancePath, "Text is shorter than the bound schema permits.");
      if (Number.isInteger(rule.maxLength) && [...value].length > rule.maxLength) add("MAX_LENGTH", instancePath, "Text is longer than the bound schema permits.");
      if (typeof rule.pattern === "string" && trustedSchema) {
        try {
          if (!new RegExp(rule.pattern, "u").test(value)) add("PATTERN", instancePath, "Text does not match the bound schema pattern.");
        } catch {
          addFatal("PATTERN_INVALID", instancePath, "Bundled schema pattern is invalid.");
          return;
        }
      }
      if (rule.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || Number.isNaN(Date.parse(value)))) add("FORMAT_DATE_TIME", instancePath, "Text is not a valid RFC 3339 date-time.");
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (typeof rule.minimum === "number" && value < rule.minimum) add("MINIMUM", instancePath, "Number is below the bound minimum.");
      if (typeof rule.maximum === "number" && value > rule.maximum) add("MAXIMUM", instancePath, "Number is above the bound maximum.");
    }
    if (Array.isArray(value)) {
      if (Number.isInteger(rule.minItems) && value.length < rule.minItems) add("MIN_ITEMS", instancePath, "Array has too few items.");
      if (Number.isInteger(rule.maxItems) && value.length > rule.maxItems) add("MAX_ITEMS", instancePath, "Array has too many items for its declared extension schema.");
      if (rule.uniqueItems === true) {
        const unique = new Set();
        let duplicate = false;
        for (const [index, entry] of value.entries()) {
          if (!consumeValidationBudget(`${instancePath}[${index}]`)) return;
          const key = canonicalJson(entry);
          if (unique.has(key)) duplicate = true;
          else unique.add(key);
        }
        if (duplicate) add("UNIQUE_ITEMS", instancePath, "Array items must be unique.");
      }
      if (rule.contains !== undefined) {
        let matchCount = 0;
        for (const [index, entry] of value.entries()) {
          const candidateIssues = branchIssuesFor(entry, rule.contains, `${instancePath}[${index}]`, depth);
          if (fatalIssue !== null) return;
          if (candidateIssues.length === 0) matchCount += 1;
        }
        const minimumMatches = Number.isInteger(rule.minContains) ? rule.minContains : 1;
        const maximumMatches = Number.isInteger(rule.maxContains) ? rule.maxContains : Number.POSITIVE_INFINITY;
        if (matchCount < minimumMatches || matchCount > maximumMatches) add("CONTAINS", instancePath, `Array contains ${matchCount} matching items; expected ${minimumMatches}..${maximumMatches === Number.POSITIVE_INFINITY ? "unbounded" : maximumMatches}.`);
      }
      const prefixCount = Array.isArray(rule.prefixItems) ? rule.prefixItems.length : 0;
      if (Array.isArray(rule.prefixItems)) {
        for (const [index, entry] of rule.prefixItems.entries()) {
          if (index < value.length) check(value[index], entry, `${instancePath}[${index}]`, depth + 1);
          else consumeValidationBudget(`${instancePath}.<prefix:${index}>`);
          if (fatalIssue !== null) return;
        }
      }
      if (rule.items !== undefined) {
        for (let index = prefixCount; index < value.length; index += 1) {
          check(value[index], rule.items, `${instancePath}[${index}]`, depth + 1);
          if (fatalIssue !== null) return;
        }
      }
    }
    if (isObject(value)) {
      const valueKeys = Object.keys(value);
      if (Number.isInteger(rule.minProperties) && valueKeys.length < rule.minProperties) add("MIN_PROPERTIES", instancePath, "Object has too few properties.");
      if (Number.isInteger(rule.maxProperties) && valueKeys.length > rule.maxProperties) add("MAX_PROPERTIES", instancePath, "Object has too many properties.");
      if (Array.isArray(rule.required)) {
        for (const key of rule.required) {
          if (!consumeValidationBudget(instancePath)) return;
          if (!Object.prototype.hasOwnProperty.call(value, key)) add("REQUIRED", `${instancePath}.${key}`, "Required property is missing.");
        }
      }
      const properties = isObject(rule.properties) ? rule.properties : {};
      for (const [key, propertyRule] of Object.entries(properties)) {
        if (!consumeValidationBudget(`${instancePath}.${key}`)) return;
        if (Object.prototype.hasOwnProperty.call(value, key)) check(value[key], propertyRule, `${instancePath}.${key}`, depth + 1);
        if (fatalIssue !== null) return;
      }
      for (const key of valueKeys) {
        if (!consumeValidationBudget(`${instancePath}.${key}`)) return;
        if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
        if (rule.additionalProperties === false) add("ADDITIONAL_PROPERTY", `${instancePath}.${key}`, "Unexpected property is forbidden by the bound schema.");
        else if (isObject(rule.additionalProperties) || typeof rule.additionalProperties === "boolean") check(value[key], rule.additionalProperties, `${instancePath}.${key}`, depth + 1);
        if (fatalIssue !== null) return;
      }
    }
  }
  check(instance, schema, "$", 0);
  return fatalIssue === null ? issues : [fatalIssue];
}

export function extensionBytesFor(extensionSchemaBytes, schemaPath) {
  if (extensionSchemaBytes instanceof Map) return extensionSchemaBytes.get(schemaPath);
  if (isObject(extensionSchemaBytes) && Object.prototype.hasOwnProperty.call(extensionSchemaBytes, schemaPath)) return extensionSchemaBytes[schemaPath];
  return undefined;
}
