import { canonicalJson } from './canonical-json.mjs';

/** Local candidate limits, not a promise about an onchain engine's execution budget. */
export const OPEN_CONFIG_LIMITS = Object.freeze({
  schemaDepth: 12, schemaNodes: 512, recordFields: 64, variantBranches: 64, arrayItems: 256,
  stringBytes: 16_384, bytesLength: 16_384, schemaBytes: 65_536, valueBytes: 131_072,
  contextBytes: 131_072, jsonDepth: 32, jsonNodes: 16_384, encodedBytes: 262_144,
});

export class OpenConfigError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'OpenConfigError';
    this.code = code;
    this.path = path;
  }
}

const UTF8 = new TextEncoder();
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REFERENCE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT256_DECIMAL = MAX_UINT256.toString();

function fail(code, path, message) { throw new OpenConfigError(code, path, message); }
function need(condition, code, path, message) { if (!condition) fail(code, path, message); }
function at(path, key) { return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`; }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (point >= 0xdc00 && point <= 0xdfff) return false;
  }
  return true;
}
function dataString(value, path, maximum, allowEmpty = true) {
  need(typeof value === 'string', 'OPEN_CONFIG_TYPE', path, 'Expected a string');
  need(wellFormed(value), 'OPEN_CONFIG_UNICODE', path, 'Unpaired Unicode surrogates are not supported');
  need((allowEmpty || value.length > 0) && value.length <= maximum && UTF8.encode(value).length <= maximum,
    'OPEN_CONFIG_STRING_LIMIT', path, `String exceeds its ${maximum}-byte UTF-8 bound or is empty`);
}

/**
 * Inspect descriptors before reading data. In particular, canonicalJson's array
 * mapping must never be the first operation on an untrusted accessor array.
 * Plain in-memory JSON data is accepted; functions, BigInts and exotic objects are not.
 */
function inspectJson(value, path, maximumBytes) {
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  function charge(amount, location) {
    bytes += amount;
    need(bytes <= maximumBytes, 'OPEN_CONFIG_JSON_LIMIT', location, `JSON exceeds ${maximumBytes} bytes`);
  }
  function visit(item, location, depth) {
    need(depth <= OPEN_CONFIG_LIMITS.jsonDepth, 'OPEN_CONFIG_JSON_DEPTH', location, 'JSON nesting is too deep');
    need(++nodes <= OPEN_CONFIG_LIMITS.jsonNodes, 'OPEN_CONFIG_JSON_NODES', location, 'JSON has too many values');
    if (typeof item === 'string') {
      dataString(item, location, maximumBytes);
      charge(UTF8.encode(JSON.stringify(item)).length, location); return;
    }
    if (item === null || typeof item === 'boolean') { charge(item === null ? 4 : item ? 4 : 5, location); return; }
    if (typeof item === 'number') {
      need(Number.isSafeInteger(item) && !Object.is(item, -0), 'OPEN_CONFIG_NUMBER', location, 'JSON numbers must be safe integers; use a decimal string for large uint values');
      charge(String(item).length, location); return;
    }
    need(item !== null && typeof item === 'object', 'OPEN_CONFIG_JSON_TYPE', location, 'Expected plain JSON data');
    need(!ancestors.has(item), 'OPEN_CONFIG_CYCLE', location, 'Cyclic data is not supported');
    need(Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype : plain(item),
      'OPEN_CONFIG_PROTOTYPE', location, 'Only plain records and ordinary arrays are supported');
    const keys = Reflect.ownKeys(item);
    need(keys.length <= OPEN_CONFIG_LIMITS.jsonNodes, 'OPEN_CONFIG_JSON_NODES', location, 'Too many object properties');
    need(keys.every((key) => typeof key === 'string'), 'OPEN_CONFIG_PROPERTY', location, 'Symbol properties are not supported');
    ancestors.add(item);
    charge(2, location);
    if (Array.isArray(item)) {
      const length = Object.getOwnPropertyDescriptor(item, 'length').value;
      need(length <= OPEN_CONFIG_LIMITS.jsonNodes && keys.length === length + 1,
        'OPEN_CONFIG_ARRAY_SHAPE', location, 'Arrays must be dense and have no extra properties');
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
          'OPEN_CONFIG_ACCESSOR', at(location, index), 'Array entries must be enumerable data properties');
        if (index) charge(1, location);
        visit(descriptor.value, at(location, index), depth + 1);
      }
    } else {
      let index = 0;
      for (const key of keys) {
        need(!RESERVED.has(key), 'OPEN_CONFIG_RESERVED_KEY', at(location, key), 'Reserved keys are not supported');
        dataString(key, at(location, key), maximumBytes);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
          'OPEN_CONFIG_ACCESSOR', at(location, key), 'Object fields must be enumerable data properties');
        charge(UTF8.encode(JSON.stringify(key)).length + 1 + (index++ ? 1 : 0), location);
        visit(descriptor.value, at(location, key), depth + 1);
      }
    }
    ancestors.delete(item);
  }
  visit(value, path, 0);
  // The safe walk precedes canonicalization and gives its errors structured paths.
  return canonicalJson(value);
}

function keysOnly(value, required, optional, path) {
  need(plain(value), 'OPEN_CONFIG_TYPE', path, 'Expected a plain object');
  const permitted = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) need(permitted.has(key), 'OPEN_CONFIG_UNKNOWN_FIELD', at(path, key), 'Unknown field');
  for (const key of required) need(Object.hasOwn(value, key), 'OPEN_CONFIG_REQUIRED', at(path, key), 'Required field is missing');
}
function name(value, path, reference = false) {
  need(typeof value === 'string' && (reference ? REFERENCE_NAME : FIELD_NAME).test(value) && !RESERVED.has(value),
    'OPEN_CONFIG_NAME', path, 'Expected a bounded non-reserved identifier');
}
function integerBound(value, path, maximum, minimum = 0) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'OPEN_CONFIG_BOUND', path, `Expected an integer from ${minimum} through ${maximum}`);
}
function uint(value, path) {
  if (typeof value === 'number') {
    need(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
      'OPEN_CONFIG_UINT', path, 'Use a nonnegative safe integer or unsigned decimal string');
    return BigInt(value);
  }
  need(typeof value === 'string' && /^[0-9]+$/.test(value), 'OPEN_CONFIG_UINT', path, 'Expected an unsigned decimal string');
  const normalized = value.replace(/^0+(?=.)/, '');
  need(normalized.length < MAX_UINT256_DECIMAL.length
    || (normalized.length === MAX_UINT256_DECIMAL.length && normalized <= MAX_UINT256_DECIMAL),
  'OPEN_CONFIG_UINT_RANGE', path, 'Value exceeds uint256');
  return BigInt(normalized);
}
function uintRange(schema, path) {
  const bits = schema.bits ?? 256;
  integerBound(bits, at(path, 'bits'), 256, 8);
  need(bits % 8 === 0, 'OPEN_CONFIG_UINT_BITS', at(path, 'bits'), 'ABI uint widths must be multiples of eight');
  const typeMaximum = (1n << BigInt(bits)) - 1n;
  const minimum = Object.hasOwn(schema, 'min') ? uint(schema.min, at(path, 'min')) : 0n;
  const maximum = Object.hasOwn(schema, 'max') ? uint(schema.max, at(path, 'max')) : typeMaximum;
  need(minimum <= maximum && maximum <= typeMaximum, 'OPEN_CONFIG_UINT_RANGE', path, 'Invalid uint range for its ABI width');
  return { bits, minimum, maximum };
}

export function assertOpenConfigSchema(schema) {
  inspectJson(schema, '/schema', OPEN_CONFIG_LIMITS.schemaBytes);
  let nodes = 0;
  function visit(node, path, depth) {
    need(depth <= OPEN_CONFIG_LIMITS.schemaDepth, 'OPEN_CONFIG_SCHEMA_DEPTH', path, 'Schema nesting is too deep');
    need(++nodes <= OPEN_CONFIG_LIMITS.schemaNodes, 'OPEN_CONFIG_SCHEMA_NODES', path, 'Schema has too many nodes');
    need(plain(node) && typeof node.type === 'string', 'OPEN_CONFIG_SCHEMA_TYPE', path, 'Every schema node needs a type');
    const metadata = ['label', 'help'];
    if (Object.hasOwn(node, 'label')) dataString(node.label, at(path, 'label'), 120, false);
    if (Object.hasOwn(node, 'help')) dataString(node.help, at(path, 'help'), 2000, false);
    if (node.type === 'record') {
      keysOnly(node, ['type', 'fields', 'required'], metadata, path);
      need(plain(node.fields), 'OPEN_CONFIG_SCHEMA_FIELDS', at(path, 'fields'), 'Record fields must be an object');
      const fields = Object.keys(node.fields).sort();
      need(fields.length <= OPEN_CONFIG_LIMITS.recordFields, 'OPEN_CONFIG_SCHEMA_FIELDS', at(path, 'fields'), 'Record has too many fields');
      need(Array.isArray(node.required), 'OPEN_CONFIG_SCHEMA_REQUIRED', at(path, 'required'), 'required must be an array');
      const required = new Set();
      for (let index = 0; index < node.required.length; index++) {
        const key = node.required[index];
        name(key, at(at(path, 'required'), index));
        need(Object.hasOwn(node.fields, key) && !required.has(key), 'OPEN_CONFIG_SCHEMA_REQUIRED', at(at(path, 'required'), index), 'Required field must exist and occur once');
        required.add(key);
      }
      for (const field of fields) { name(field, at(at(path, 'fields'), field)); visit(node.fields[field], at(at(path, 'fields'), field), depth + 1); }
    } else if (node.type === 'array') {
      keysOnly(node, ['type', 'items', 'maxItems'], [...metadata, 'minItems'], path);
      integerBound(node.maxItems, at(path, 'maxItems'), OPEN_CONFIG_LIMITS.arrayItems);
      integerBound(node.minItems ?? 0, at(path, 'minItems'), node.maxItems);
      visit(node.items, at(path, 'items'), depth + 1);
    } else if (node.type === 'uint') {
      keysOnly(node, ['type'], [...metadata, 'bits', 'min', 'max', 'unit'], path);
      uintRange(node, path);
      if (Object.hasOwn(node, 'unit')) dataString(node.unit, at(path, 'unit'), 128, false);
    } else if (node.type === 'string' || node.type === 'bytes') {
      keysOnly(node, ['type', 'maxLength'], metadata, path);
      integerBound(node.maxLength, at(path, 'maxLength'), node.type === 'string' ? OPEN_CONFIG_LIMITS.stringBytes : OPEN_CONFIG_LIMITS.bytesLength);
    } else if (['bool', 'address', 'account', 'asset', 'component'].includes(node.type)) {
      keysOnly(node, ['type'], metadata, path);
    } else if (node.type === 'variant') {
      keysOnly(node, ['type', 'tag', 'variants'], metadata, path);
      name(node.tag, at(path, 'tag'));
      need(plain(node.variants), 'OPEN_CONFIG_SCHEMA_VARIANTS', at(path, 'variants'), 'Variant branches must be an object');
      const branches = Object.keys(node.variants).sort();
      need(branches.length > 0 && branches.length <= OPEN_CONFIG_LIMITS.variantBranches,
        'OPEN_CONFIG_SCHEMA_VARIANTS', at(path, 'variants'), 'Variant needs one to 64 branches');
      for (const branch of branches) {
        const location = at(at(path, 'variants'), branch);
        name(branch, location);
        need(plain(node.variants[branch]) && node.variants[branch].type === 'record',
          'OPEN_CONFIG_VARIANT_RECORD', location, 'Each variant branch must be a record schema');
        visit(node.variants[branch], location, depth + 1);
        need(!Object.hasOwn(node.variants[branch].fields, node.tag), 'OPEN_CONFIG_VARIANT_TAG', location, 'Branch fields cannot contain the discriminator');
      }
    } else fail('OPEN_CONFIG_SCHEMA_TYPE', at(path, 'type'), 'Unsupported schema type');
  }
  visit(schema, '/schema', 0);
}
