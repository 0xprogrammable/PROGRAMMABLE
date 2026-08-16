import {
  EXACT_PACKAGE_VERSION_PATTERN_SOURCE,
  NPM_PACKAGE_NAME_PATTERN_SOURCE,
  SHA512_INTEGRITY_PATTERN_SOURCE
} from "./package-dependency-contract.mjs";
import {
  JSON_SCHEMA_KEYWORD_PROFILES,
  jsonSchemaKeywordIsSupported
} from "./json-schema-keyword-contract.mjs";
import { isObject } from "./submission-value-core.mjs";

const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 8192;
const MAX_REFERENCE_DEPTH = 64;
const MAX_PATTERN_LENGTH = 256;

const approvedSchemaPatterns = new Set([
  "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$",
  "^0x[a-fA-F0-9]{40}$",
  "^[0-9]+\\.[0-9]+\\.[0-9]+$",
  "^[a-z][a-z0-9-]*$",
  "^[0-9]+$",
  "^(?:0|[1-9][0-9]*)$",
  "^-?(?:0|[1-9][0-9]*)$",
  "^[1-9][0-9]{0,38}$",
  "^(?:0|[1-9][0-9]{0,38})$",
  "^[1-9][0-9]{0,63}$",
  "^[1-9][0-9]{0,9}$",
  "^[1-9][0-9]{0,77}$",
  "^0x(?:[0-9a-fA-F]{2})*$",
  "^0x(?:[0-9a-f]{2})*$",
  "^0x(?:[0-9a-f]{2})+$",
  "^0x(?:[0-9a-fA-F]{2}){192}$",
  "^0x(?!0{40}$)[a-fA-F0-9]{40}$",
  "^0x(?!0{64}$)[a-fA-F0-9]{64}$",
  "^0x[a-fA-F0-9]{64}$",
  "^0x[0-9a-fA-F]{40}$",
  "^0x[0-9a-fA-F]{64}$",
  "^0x[0-3][0-9a-fA-F]{3}$",
  "^0x[0-9a-f]{64}$",
  "^0x[0-9a-f]{40}$",
  "^0x(?!0{40}$)[0-9a-f]{40}$",
  "^(?!0{40}$)[0-9a-f]{40}$",
  "^[a-fA-F0-9]{40}$",
  "^[1-9][0-9]*$",
  "^[A-Z0-9_]+$",
  "^[A-Z0-9]{1,12}$",
  "^[a-zA-Z0-9_-]{12,80}$",
  "^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$",
  "^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$",
  "^(?!\\.{1,2}$)(?!.*\\.git$)(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]{1,100}$",
  "^[a-z0-9][a-z0-9._-]{0,127}$",
  "^https://github\\.com/[a-z0-9-]+/[a-z0-9._-]+/actions/runs/[1-9][0-9]{0,63}$",
  "^https://github\\.com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9._-]{1,100}/pull/[1-9][0-9]{0,9}$",
  "^https://github\\.com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9._-]{1,100}/pull/[1-9][0-9]{0,9}#pullrequestreview-[1-9][0-9]{0,63}$",
  "^refs/pull/[1-9][0-9]{0,9}/head$",
  "^(0|[1-9][0-9]{0,4})$",
  "^sha256:[a-f0-9]{64}$",
  "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\)[^\\u0000-\\u001f\\u007f-\\u009f]+$",
  NPM_PACKAGE_NAME_PATTERN_SOURCE,
  EXACT_PACKAGE_VERSION_PATTERN_SOURCE,
  SHA512_INTEGRITY_PATTERN_SOURCE,
  "^[-a-z0-9]{3,8}$",
  "^[-_a-zA-Z0-9]{1,32}$",
  "^(?:https://|ipfs://|ar://)[^\\s]{1,2024}$",
  "^https://[^\\s]{1,2024}$",
  "^https://github\\.com/(?![^/]*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?/(?!\\.{1,2}$)(?!.*\\.git$)(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]{1,100}$",
  "^https://github\\.com/(?![^/]*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/(?!\\.{1,2}$)(?!.*\\.git$)(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$",
  "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*(?:^|/)\\.git(?:/|$))(?!.*\\\\)(?!.*(?:%2[fF]|%5[cC]))(?!.*\\/$)[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]+$",
  "^registry/acceptances/[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9.-]*\\.json$",
  "^sha256:[0-9a-f]{64}$",
  "^sha256:(?!0{64}$)[0-9a-f]{64}$",
  "^[0-9a-f]{64}$",
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
  "^[0-9a-f]{40}$",
  "^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$",
  "^[^\\u0000-\\u001f\\u007f-\\u009f]+$"
]);
const supportedSchemaFormats = new Set(["date-time", "uri"]);

export function schemaRuleShapeIsValid(rule) {
  const schemaValue = (value) => value === true || value === false || isObject(value);
  const schemaArray = (value, minimum = 1) => Array.isArray(value) && value.length >= minimum && value.every(schemaValue);
  const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
  const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const jsonTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);
  if (Object.hasOwn(rule, "type")) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (types.length === 0 || types.some((entry) => !jsonTypes.has(entry)) || new Set(types).size !== types.length) return false;
  }
  if (Object.hasOwn(rule, "enum") && (!Array.isArray(rule.enum) || rule.enum.length === 0)) return false;
  if (Object.hasOwn(rule, "required") && (!Array.isArray(rule.required) || rule.required.some((entry) => typeof entry !== "string") || new Set(rule.required).size !== rule.required.length)) return false;
  for (const key of ["properties", "$defs", "definitions"]) {
    if (Object.hasOwn(rule, key) && (!isObject(rule[key]) || Object.values(rule[key]).some((entry) => !schemaValue(entry)))) return false;
  }
  for (const key of ["items", "contains", "additionalProperties", "propertyNames", "not", "if", "then", "else"]) {
    if (Object.hasOwn(rule, key) && !schemaValue(rule[key])) return false;
  }
  if (Object.hasOwn(rule, "prefixItems") && !schemaArray(rule.prefixItems, 0)) return false;
  for (const key of ["allOf", "anyOf", "oneOf"]) if (Object.hasOwn(rule, key) && !schemaArray(rule[key])) return false;
  if (Object.hasOwn(rule, "$ref") && typeof rule.$ref !== "string") return false;
  if (Object.hasOwn(rule, "pattern") && typeof rule.pattern !== "string") return false;
  if (Object.hasOwn(rule, "format") && (typeof rule.format !== "string" || !supportedSchemaFormats.has(rule.format))) return false;
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minContains", "maxContains", "minProperties", "maxProperties"]) {
    if (Object.hasOwn(rule, key) && !nonnegativeInteger(rule[key])) return false;
  }
  if (Object.hasOwn(rule, "uniqueItems") && typeof rule.uniqueItems !== "boolean") return false;
  for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) {
    if (Object.hasOwn(rule, key) && !finiteNumber(rule[key])) return false;
  }
  if (Object.hasOwn(rule, "multipleOf") && (!finiteNumber(rule.multipleOf) || rule.multipleOf <= 0)) return false;
  if (Object.hasOwn(rule, "minContains") && !Object.hasOwn(rule, "contains")) return false;
  if (Object.hasOwn(rule, "maxContains") && !Object.hasOwn(rule, "contains")) return false;
  if (Object.hasOwn(rule, "minContains") && Object.hasOwn(rule, "maxContains") && rule.minContains > rule.maxContains) return false;
  return true;
}

export function inspectSchemaDefinition(schema, add) {
  const patterns = new WeakMap();
  if (!isObject(schema)) {
    add("SCHEMA_DEFINITION_TYPE", "$", "The schema root must be a JSON object.");
    return { valid: false, patterns };
  }

  const seen = new WeakSet();
  const active = new WeakSet();
  const stack = [{ node: schema, path: "$", depth: 0, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.leaving) {
      active.delete(current.node);
      continue;
    }
    if (current.depth > MAX_SCHEMA_DEPTH) {
      add("SCHEMA_DEPTH_LIMIT", current.path, `The schema exceeds the maximum depth of ${MAX_SCHEMA_DEPTH}.`);
      return { valid: false, patterns };
    }
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) {
      add("SCHEMA_NODE_LIMIT", current.path, `The schema exceeds the maximum of ${MAX_SCHEMA_NODES} JSON values.`);
      return { valid: false, patterns };
    }
    if (!current.node || typeof current.node !== "object") continue;
    if (active.has(current.node)) {
      add("SCHEMA_OBJECT_CYCLE", current.path, "The schema contains a direct object cycle.");
      return { valid: false, patterns };
    }
    if (seen.has(current.node)) continue;

    seen.add(current.node);
    active.add(current.node);
    stack.push({ ...current, leaving: true });
    const entries = boundedEntries(current.node, MAX_SCHEMA_NODES);
    if (!entries) {
      add("SCHEMA_NODE_LIMIT", current.path, `The schema exceeds the maximum of ${MAX_SCHEMA_NODES} JSON values.`);
      return { valid: false, patterns };
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

  const ruleInspection = inspectSchemaRules(schema, patterns, add);
  if (!ruleInspection.valid) return { valid: false, patterns };
  const referenceResult = inspectReferenceGraph(schema, ruleInspection.referenceRules, ruleInspection.rulePaths);
  if (!referenceResult.ok) {
    add(referenceResult.code, referenceResult.path, referenceResult.message);
    return { valid: false, patterns };
  }
  return { valid: true, patterns };
}

function inspectSchemaRules(schema, patterns, add) {
  const rulePaths = new WeakMap();
  const referenceRules = [];
  const seen = new WeakSet();
  const stack = [{ rule: schema, path: "$" }];
  while (stack.length > 0) {
    const { rule, path: rulePath } = stack.pop();
    if (typeof rule === "boolean") continue;
    if (!isObject(rule)) {
      add("SCHEMA_RULE_INVALID", rulePath, "Schema positions must contain an object or boolean schema.");
      return { valid: false, referenceRules, rulePaths };
    }
    if (seen.has(rule)) continue;
    seen.add(rule);
    rulePaths.set(rule, rulePath);
    const unknownKeywords = Object.keys(rule).filter((key) => !jsonSchemaKeywordIsSupported(JSON_SCHEMA_KEYWORD_PROFILES.restrictedSubmission, key));
    if (unknownKeywords.length > 0) {
      add("SCHEMA_KEYWORD_UNSUPPORTED", `${rulePath}.${unknownKeywords[0]}`, `Unsupported schema keyword ${unknownKeywords[0]} would otherwise be ignored.`);
      return { valid: false, referenceRules, rulePaths };
    }
    if (!schemaRuleShapeIsValid(rule)) {
      add("SCHEMA_KEYWORD_INVALID", rulePath, "Schema structure keywords must use the supported JSON shapes.");
      return { valid: false, referenceRules, rulePaths };
    }
    if (Object.hasOwn(rule, "$ref")) {
      const target = resolveLocalReference(schema, rule.$ref);
      if (target === null) {
        add("SCHEMA_REFERENCE_INVALID", rulePath, "Schema references must resolve to a local object or boolean schema.");
        return { valid: false, referenceRules, rulePaths };
      }
      referenceRules.push(rule);
    }
    if (Object.hasOwn(rule, "pattern")) {
      const compiled = compileRestrictedPattern(rule.pattern);
      if (!compiled.ok) {
        add(compiled.code, `${rulePath}.pattern`, compiled.message);
        return { valid: false, referenceRules, rulePaths };
      }
      patterns.set(rule, compiled.pattern);
    }
    for (const child of schemaDefinitionChildren(rule, rulePath)) stack.push(child);
  }
  return { valid: true, referenceRules, rulePaths };
}

function schemaDefinitionChildren(rule, rulePath) {
  const children = [];
  const pushMap = (key) => {
    if (!isObject(rule[key])) return;
    for (const [name, child] of Object.entries(rule[key])) children.push({ rule: child, path: `${rulePath}.${key}.${name}` });
  };
  pushMap("$defs");
  pushMap("definitions");
  pushMap("properties");
  for (const key of ["items", "contains", "additionalProperties", "propertyNames", "not", "if", "then", "else"]) {
    if (rule[key] !== undefined) children.push({ rule: rule[key], path: `${rulePath}.${key}` });
  }
  for (const key of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(rule[key])) rule[key].forEach((child, index) => children.push({ rule: child, path: `${rulePath}.${key}[${index}]` }));
  }
  return children;
}

function inspectReferenceGraph(schema, referenceRules, rulePaths) {
  const state = new WeakMap();
  const maximumReferenceDepth = new WeakMap();

  function visit(rule) {
    if (!isObject(rule)) return { ok: true, depth: 0 };
    if (state.get(rule) === 1) {
      return {
        ok: false,
        code: "SCHEMA_REFERENCE_CYCLE",
        path: rulePaths.get(rule) ?? "$",
        message: "The schema contains a recursive local reference cycle."
      };
    }
    if (state.get(rule) === 2) return { ok: true, depth: maximumReferenceDepth.get(rule) ?? 0 };

    state.set(rule, 1);
    let depth = 0;
    for (const child of schemaEvaluationChildren(schema, rule)) {
      const result = visit(child.rule);
      if (!result.ok) return result;
      depth = Math.max(depth, child.referenceIncrement + result.depth);
      if (depth > MAX_REFERENCE_DEPTH) {
        return {
          ok: false,
          code: "SCHEMA_REFERENCE_DEPTH_LIMIT",
          path: rulePaths.get(rule) ?? "$",
          message: `A schema reference chain exceeds ${MAX_REFERENCE_DEPTH} hops.`
        };
      }
    }
    state.set(rule, 2);
    maximumReferenceDepth.set(rule, depth);
    return { ok: true, depth };
  }

  for (const referenceRule of referenceRules) {
    const result = visit(referenceRule);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function schemaEvaluationChildren(schema, rule) {
  const children = [];
  if (typeof rule.$ref === "string") {
    const target = resolveLocalReference(schema, rule.$ref);
    if (isObject(target)) children.push({ rule: target, referenceIncrement: 1 });
  }
  for (const key of ["items", "contains", "additionalProperties", "propertyNames", "not", "if", "then", "else"]) {
    if (isObject(rule[key])) children.push({ rule: rule[key], referenceIncrement: 0 });
  }
  if (isObject(rule.properties)) {
    for (const child of Object.values(rule.properties)) {
      if (isObject(child)) children.push({ rule: child, referenceIncrement: 0 });
    }
  }
  for (const key of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    for (const child of Array.isArray(rule[key]) ? rule[key] : []) if (isObject(child)) children.push({ rule: child, referenceIncrement: 0 });
  }
  return children;
}

export function resolveLocalReference(schema, reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
  let current = schema;
  for (const rawSegment of reference.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return isObject(current) || typeof current === "boolean" ? current : null;
}


export function boundedEntries(value, maximum) {
  if (Array.isArray(value)) {
    if (value.length > maximum) return null;
    return value.map((entry, index) => [index, entry]);
  }
  const entries = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length > maximum) return null;
  }
  return entries;
}

function compileRestrictedPattern(pattern) {
  if (typeof pattern !== "string") {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_INVALID",
      message: "Schema patterns must be strings."
    };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_LIMIT",
      message: `Schema patterns may contain at most ${MAX_PATTERN_LENGTH} characters.`
    };
  }

  let compiled;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_INVALID",
      message: "The schema pattern is not a valid JavaScript regular expression."
    };
  }
  if (!approvedSchemaPatterns.has(pattern)) {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_UNSAFE",
      message: "The schema pattern is not in the validator's reviewed pattern set."
    };
  }
  return { ok: true, pattern: compiled };
}
