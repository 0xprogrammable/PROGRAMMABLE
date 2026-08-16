import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  CAPABILITY_COMPOSITION_V1_KIND,
  COMPOSITION_CHECKER_VERSION
} from "./composition-checker-shared.mjs";

export const CAPABILITY_CONTRACT_V1_SCHEMA_ID = "urn:programmable:capability-contract:1.0.0";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptDirectory, "../references/capability-contract-v1.schema.json");
const capabilitySchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

if (capabilitySchema.$id !== CAPABILITY_CONTRACT_V1_SCHEMA_ID) {
  throw new Error("Capability-contract schema id disagrees with the composition checker.");
}

export function capabilityContractV1Errors(contract, { path: contractPath = "$" } = {}) {
  const errors = [];
  validateSchemaValue(contract, capabilitySchema, contractPath, capabilitySchema, errors, 0);
  return errors.slice(0, 256);
}

export function compositionEnvelopeErrors(input) {
  const errors = [];
  if (!isPlainObject(input)) return [{ path: "$", keyword: "type", message: "Composition input must be one plain object." }];
  const expected = ["schemaVersion", "kind", "stage", "components"];
  for (const key of expected) if (!Object.hasOwn(input, key)) errors.push({ path: `$.${key}`, keyword: "required", message: `Missing required composition field ${key}.` });
  for (const key of Object.keys(input)) if (!expected.includes(key)) errors.push({ path: `$.${key}`, keyword: "additionalProperties", message: `Unknown composition field ${key}.` });
  if (input.schemaVersion !== COMPOSITION_CHECKER_VERSION) errors.push({ path: "$.schemaVersion", keyword: "const", message: `schemaVersion must equal ${COMPOSITION_CHECKER_VERSION}.` });
  if (input.kind !== CAPABILITY_COMPOSITION_V1_KIND) errors.push({ path: "$.kind", keyword: "const", message: `kind must equal ${CAPABILITY_COMPOSITION_V1_KIND}.` });
  if (!["proposal", "prototype", "release"].includes(input.stage)) errors.push({ path: "$.stage", keyword: "enum", message: "stage must be proposal, prototype, or release." });
  if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > 128) errors.push({ path: "$.components", keyword: "minItems/maxItems", message: "components must contain 1 through 128 capability contracts." });
  return errors;
}

function validateSchemaValue(value, schema, valuePath, root, errors, depth) {
  if (errors.length >= 256) return;
  if (depth > 128) {
    errors.push({ path: valuePath, keyword: "depth", message: "Value exceeds validation depth." });
    return;
  }
  if (schema.$ref) {
    validateSchemaValue(value, resolveLocalRef(root, schema.$ref), valuePath, root, errors, depth + 1);
    return;
  }
  if (schema.oneOf) {
    const branches = schema.oneOf.map((branch) => {
      const branchErrors = [];
      validateSchemaValue(value, branch, valuePath, root, branchErrors, depth + 1);
      return branchErrors;
    });
    const matches = branches.filter((branchErrors) => branchErrors.length === 0);
    if (matches.length !== 1) errors.push({ path: valuePath, keyword: "oneOf", message: `Expected exactly one schema branch, matched ${matches.length}.` });
    return;
  }
  if (Object.hasOwn(schema, "const") && !same(value, schema.const)) errors.push({ path: valuePath, keyword: "const", message: `Expected ${JSON.stringify(schema.const)}.` });
  if (schema.enum && !schema.enum.some((candidate) => same(value, candidate))) errors.push({ path: valuePath, keyword: "enum", message: "Value is not in the closed enum." });
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push({ path: valuePath, keyword: "type", message: `Expected ${schema.type}.` });
    return;
  }
  validateString(value, schema, valuePath, errors);
  validateArray(value, schema, valuePath, root, errors, depth);
  validateObject(value, schema, valuePath, root, errors, depth);
}

function validateString(value, schema, valuePath, errors) {
  if (typeof value !== "string") return;
  if (!isUnicodeScalarString(value)) {
    errors.push({ path: valuePath, keyword: "unicodeScalar", message: "String contains an unpaired UTF-16 surrogate." });
    return;
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: valuePath, keyword: "minLength", message: `String is shorter than ${schema.minLength}.` });
  if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: valuePath, keyword: "maxLength", message: `String is longer than ${schema.maxLength}.` });
  if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push({ path: valuePath, keyword: "pattern", message: "String does not match the required pattern." });
}

function validateArray(value, schema, valuePath, root, errors, depth) {
  if (!Array.isArray(value)) return;
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: valuePath, keyword: "minItems", message: `Array has fewer than ${schema.minItems} items.` });
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: valuePath, keyword: "maxItems", message: `Array has more than ${schema.maxItems} items.` });
  if (schema.uniqueItems) {
    try {
      const identities = value.map((entry) => canonicalJsonV2(entry));
      if (new Set(identities).size !== identities.length) errors.push({ path: valuePath, keyword: "uniqueItems", message: "Array items must be unique." });
    } catch {
      errors.push({ path: valuePath, keyword: "uniqueItems", message: "Array contains a value outside the canonical JSON domain." });
    }
  }
  if (schema.items) value.forEach((entry, index) => validateSchemaValue(entry, schema.items, `${valuePath}[${index}]`, root, errors, depth + 1));
}

function validateObject(value, schema, valuePath, root, errors, depth) {
  if (!isPlainObject(value)) return;
  if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) errors.push({ path: valuePath, keyword: "maxProperties", message: `Object has more than ${schema.maxProperties} properties.` });
  for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push({ path: `${valuePath}.${required}`, keyword: "required", message: `Missing required property ${required}.` });
  if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push({ path: `${valuePath}.${key}`, keyword: "additionalProperties", message: `Unknown property ${key}.` });
  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateSchemaValue(value[key], childSchema, `${valuePath}.${key}`, root, errors, depth + 1);
}

function resolveLocalRef(root, reference) {
  if (!reference.startsWith("#/$defs/")) throw new Error(`Unsupported capability schema reference ${reference}`);
  const key = reference.slice("#/$defs/".length).replaceAll("~1", "/").replaceAll("~0", "~");
  const resolved = root.$defs?.[key];
  if (!resolved) throw new Error(`Missing capability schema definition ${key}`);
  return resolved;
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  return typeof value === type;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function same(left, right) {
  try {
    return canonicalJsonV2(left) === canonicalJsonV2(right);
  } catch {
    return Object.is(left, right);
  }
}

function isUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
