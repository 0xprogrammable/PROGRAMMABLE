import { performance } from "node:perf_hooks";
import {
  JSON_SCHEMA_KEYWORD_PROFILES,
  jsonSchemaKeywordIsSupported
} from "./json-schema-keyword-contract.mjs";
import { canonicalJson, isObject } from "./open-world-v2-primitives.mjs";

const MAX_EXTENSION_SCHEMA_INSPECTION_STEPS = 60000;
const MAX_EXTENSION_SCHEMA_INSPECTION_MS = 1000;

export function matchesJsonType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function resolveLocalSchemaRef(root, reference) {
  if (reference === "#") return root;
  if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
  let current = root;
  for (const encoded of reference.slice(2).split("/")) {
    const key = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, key)) return null;
    current = current[key];
  }
  return current;
}

function isSyntacticallyValidSchemaReference(reference) {
  if (typeof reference !== "string" || reference.length === 0 || /[\u0000-\u0020\u007f]/u.test(reference) || /%(?![0-9a-fA-F]{2})/u.test(reference)) return false;
  try {
    new URL(reference, "https://programmable.invalid/schema-base/");
    return true;
  } catch {
    return false;
  }
}

export function inspectSchemaKeywords(schema, { trustedSchema = false } = {}) {
  const issues = [];
  const startedAt = performance.now();
  let inspectionSteps = 0;
  let fatalIssue = null;
  const add = (code, schemaPath, message) => {
    if (issues.length < 128) issues.push({ code, path: "$", message: `${message} (${schemaPath})` });
  };
  const addFatal = (code, schemaPath, message) => {
    if (fatalIssue === null) fatalIssue = { code, path: "$", message: `${message} (${schemaPath})` };
  };
  const consumeBudget = (schemaPath) => {
    if (fatalIssue !== null) return false;
    inspectionSteps += 1;
    if (inspectionSteps > MAX_EXTENSION_SCHEMA_INSPECTION_STEPS) {
      addFatal("SCHEMA_INSPECTION_STEP_LIMIT", schemaPath, `Schema inspection exceeds ${MAX_EXTENSION_SCHEMA_INSPECTION_STEPS.toLocaleString("en-US")} bounded operations`);
      return false;
    }
    if ((inspectionSteps & 255) === 0 && performance.now() - startedAt > MAX_EXTENSION_SCHEMA_INSPECTION_MS) {
      addFatal("SCHEMA_INSPECTION_TIME_LIMIT", schemaPath, `Schema inspection exceeds the ${MAX_EXTENSION_SCHEMA_INSPECTION_MS}ms safety budget`);
      return false;
    }
    return true;
  };
  const reserveBudget = (count, schemaPath) => {
    if (fatalIssue !== null) return false;
    if (!Number.isInteger(count) || count < 0 || inspectionSteps + count > MAX_EXTENSION_SCHEMA_INSPECTION_STEPS) {
      addFatal("SCHEMA_INSPECTION_STEP_LIMIT", schemaPath, `Schema inspection exceeds ${MAX_EXTENSION_SCHEMA_INSPECTION_STEPS.toLocaleString("en-US")} bounded operations`);
      return false;
    }
    inspectionSteps += count;
    if (performance.now() - startedAt > MAX_EXTENSION_SCHEMA_INSPECTION_MS) {
      addFatal("SCHEMA_INSPECTION_TIME_LIMIT", schemaPath, `Schema inspection exceeds the ${MAX_EXTENSION_SCHEMA_INSPECTION_MS}ms safety budget`);
      return false;
    }
    return true;
  };
  const has = (rule, keyword) => Object.prototype.hasOwnProperty.call(rule, keyword);
  const allowedTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);
  const assertNonNegativeInteger = (rule, keyword, schemaPath) => {
    if (has(rule, keyword) && (!Number.isInteger(rule[keyword]) || rule[keyword] < 0)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.${keyword}`, `${keyword} must be a non-negative integer`);
  };
  function inspect(rule, schemaPath, depth = 0) {
    if (!consumeBudget(schemaPath)) return;
    if (rule === true || rule === false) return;
    if (!isObject(rule)) {
      add("SCHEMA_RULE_INVALID", schemaPath, "Schema rule must be an object or boolean");
      return;
    }
    if (depth > 64) {
      addFatal("SCHEMA_DEFINITION_DEPTH_LIMIT", schemaPath, "Schema definition exceeds depth 64");
      return;
    }
    for (const keyword of Object.keys(rule)) {
      if (!consumeBudget(`${schemaPath}.${keyword}`)) return;
      if (!jsonSchemaKeywordIsSupported(JSON_SCHEMA_KEYWORD_PROFILES.openWorldExtension, keyword)) add("SCHEMA_KEYWORD_UNSUPPORTED", `${schemaPath}.${keyword}`, `Schema keyword ${keyword} is valid extension vocabulary but is not implemented by the bounded local validator`);
    }
    for (const keyword of ["$schema", "$id", "$comment", "title", "description"]) {
      if (has(rule, keyword) && typeof rule[keyword] !== "string") add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.${keyword}`, `${keyword} must be a string`);
    }
    if (has(rule, "$ref")) {
      if (typeof rule.$ref !== "string" || rule.$ref.length === 0) add("SCHEMA_REFERENCE_INVALID", `${schemaPath}.$ref`, "$ref must be a non-empty URI reference");
      else if (rule.$ref === "#" || rule.$ref.startsWith("#/")) {
        if (resolveLocalSchemaRef(schema, rule.$ref) === null) add("SCHEMA_REFERENCE_INVALID", `${schemaPath}.$ref`, "Local $ref JSON Pointer does not resolve to an own property");
      } else if (isSyntacticallyValidSchemaReference(rule.$ref)) {
        add("SCHEMA_REFERENCE_UNSUPPORTED", `${schemaPath}.$ref`, "Syntactically valid external, anchored, or vendored $ref requires a content-addressed compatible validator integration");
      } else {
        add("SCHEMA_REFERENCE_INVALID", `${schemaPath}.$ref`, "$ref is not a valid URI reference");
      }
    }
    if (has(rule, "examples") && !Array.isArray(rule.examples)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.examples`, "examples must be an array");
    for (const keyword of ["deprecated", "readOnly", "writeOnly", "uniqueItems"]) {
      if (has(rule, keyword) && typeof rule[keyword] !== "boolean") add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.${keyword}`, `${keyword} must be a boolean`);
    }
    if (has(rule, "type")) {
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!reserveBudget(types.length, `${schemaPath}.type`)) return;
      if (types.length === 0 || types.some((type) => typeof type !== "string" || !allowedTypes.has(type)) || new Set(types).size !== types.length) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.type`, "type must be one supported type or a non-empty unique array of supported types");
    }
    if (has(rule, "enum")) {
      if (!Array.isArray(rule.enum)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.enum`, "enum must be a non-empty array of unique JSON values");
      else {
        if (!reserveBudget(rule.enum.length, `${schemaPath}.enum`)) return;
        if (rule.enum.length === 0 || new Set(rule.enum.map(canonicalJson)).size !== rule.enum.length) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.enum`, "enum must be a non-empty array of unique JSON values");
      }
    }
    if (has(rule, "required")) {
      if (!Array.isArray(rule.required)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.required`, "required must be an array of unique strings");
      else {
        if (!reserveBudget(rule.required.length, `${schemaPath}.required`)) return;
        if (rule.required.some((entry) => typeof entry !== "string") || new Set(rule.required).size !== rule.required.length) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.required`, "required must be an array of unique strings");
      }
    }
    for (const keyword of ["minProperties", "maxProperties", "minContains", "maxContains", "minItems", "maxItems", "minLength", "maxLength"]) assertNonNegativeInteger(rule, keyword, schemaPath);
    for (const keyword of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) if (has(rule, keyword) && (typeof rule[keyword] !== "number" || !Number.isFinite(rule[keyword]))) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.${keyword}`, `${keyword} must be a finite number`);
    if (has(rule, "multipleOf") && (typeof rule.multipleOf !== "number" || !Number.isFinite(rule.multipleOf) || rule.multipleOf <= 0)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.multipleOf`, "multipleOf must be a positive finite number");
    if (has(rule, "dependentRequired")) {
      if (!isObject(rule.dependentRequired)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.dependentRequired`, "dependentRequired must be an object of unique string arrays");
      else for (const [property, dependencies] of Object.entries(rule.dependentRequired)) {
        if (!Array.isArray(dependencies) || dependencies.some((entry) => typeof entry !== "string") || new Set(dependencies).size !== dependencies.length) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.dependentRequired.${property}`, "dependentRequired entries must be arrays of unique strings");
      }
    }
    if (has(rule, "unevaluatedProperties") && rule.unevaluatedProperties !== true && rule.unevaluatedProperties !== false && !isObject(rule.unevaluatedProperties)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.unevaluatedProperties`, "unevaluatedProperties must be a schema object or boolean");
    if (has(rule, "propertyNames") && rule.propertyNames !== true && rule.propertyNames !== false && !isObject(rule.propertyNames)) add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.propertyNames`, "propertyNames must be a schema object or boolean");
    if (has(rule, "pattern") && typeof rule.pattern !== "string") add("SCHEMA_KEYWORD_SHAPE_INVALID", `${schemaPath}.pattern`, "pattern must be a string");
    if (!trustedSchema && typeof rule.pattern === "string") add("SCHEMA_PATTERN_TOOLING_REVIEW_REQUIRED", `${schemaPath}.pattern`, "Repository schema patterns require a compatible bounded JSON Schema engine; native regular-expression evaluation is not used automatically");
    if (rule.format !== undefined && rule.format !== "date-time") add("SCHEMA_FORMAT_UNSUPPORTED", `${schemaPath}.format`, `Unsupported schema format ${String(rule.format)}`);
    if ((rule.minContains !== undefined || rule.maxContains !== undefined) && rule.contains === undefined) add("SCHEMA_CONTAINS_CONTRACT_INVALID", schemaPath, "minContains/maxContains requires contains");
    for (const [minimumKeyword, maximumKeyword] of [["minProperties", "maxProperties"], ["minContains", "maxContains"], ["minItems", "maxItems"], ["minLength", "maxLength"], ["minimum", "maximum"]]) {
      if (typeof rule[minimumKeyword] === "number" && typeof rule[maximumKeyword] === "number" && rule[minimumKeyword] > rule[maximumKeyword]) add("SCHEMA_RANGE_INVALID", schemaPath, `${minimumKeyword} cannot exceed ${maximumKeyword}`);
    }
    for (const container of ["$defs", "properties"]) {
      if (rule[container] === undefined) continue;
      if (!isObject(rule[container])) {
        add("SCHEMA_CONTAINER_INVALID", `${schemaPath}.${container}`, `${container} must be an object`);
        continue;
      }
      for (const [key, child] of Object.entries(rule[container])) {
        inspect(child, `${schemaPath}.${container}.${key}`, depth + 1);
        if (fatalIssue !== null) return;
      }
    }
    for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
      if (rule[keyword] === undefined) continue;
      if (!Array.isArray(rule[keyword]) || rule[keyword].length === 0) {
        add("SCHEMA_CONTAINER_INVALID", `${schemaPath}.${keyword}`, `${keyword} must be a non-empty array`);
        continue;
      }
      for (const [index, child] of rule[keyword].entries()) {
        inspect(child, `${schemaPath}.${keyword}[${index}]`, depth + 1);
        if (fatalIssue !== null) return;
      }
    }
    for (const keyword of ["not", "if", "then", "else", "items", "contains", "additionalProperties", "unevaluatedProperties", "propertyNames"]) {
      if (rule[keyword] !== undefined) {
        inspect(rule[keyword], `${schemaPath}.${keyword}`, depth + 1);
        if (fatalIssue !== null) return;
      }
    }
  }
  inspect(schema, "$schema", 0);
  return fatalIssue === null ? issues : [fatalIssue];
}
