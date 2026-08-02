#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keccak256, type Hex } from "viem";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = {
  subtype_tags: Record<string, number>;
  field_schemas: Record<string, [string, string][]>;
  expected_definition_commitments: Record<string, Hex>;
  expected_domain_definition_commitment: Hex;
  vectors: Array<{
    name: string;
    subtype: string;
    input: Record<string, unknown>;
    expected_preimage_hex: Hex;
    expected_keccak256: Hex;
  }>;
};

const utf8 = (value: string) => Buffer.from(value, "utf8");
const BASE_PREFIX = utf8("programmable:provider-evidence:v2\0");
const DEFINITION_PREFIX = utf8("programmable:provider-evidence-definition:v2\0");
const DOMAIN_DEFINITION_PREFIX = utf8("programmable:provider-evidence-domain:v2\0");

function fixedUnsigned(value: unknown, width: 4 | 8): Buffer {
  const parsed = BigInt(value as string | number | bigint);
  if (parsed < 0n || parsed >= (1n << BigInt(width * 8))) {
    throw new Error(`unsigned integer exceeds ${width * 8} bits`);
  }
  const result = Buffer.alloc(width);
  if (width === 4) result.writeUInt32BE(Number(parsed));
  else result.writeBigUInt64BE(parsed);
  return result;
}

function exactHex(value: unknown, width?: number): Buffer {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error("invalid canonical hex");
  }
  const result = Buffer.from(value.slice(2), "hex");
  if (width !== undefined && result.length !== width) throw new Error(`expected ${width} bytes`);
  return result;
}

function exactUuid(value: unknown): Buffer {
  if (typeof value !== "string" ||
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error("invalid UUID");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function framed(value: Uint8Array): Buffer {
  return Buffer.concat([fixedUnsigned(value.length, 4), value]);
}

function encodeType(type: string, value: unknown): Buffer {
  if (type === "u32") return fixedUnsigned(value, 4);
  if (type === "u64") return fixedUnsigned(value, 8);
  if (type === "uuid16") return exactUuid(value);
  if (type === "varutf8") {
    if (typeof value !== "string") throw new Error("expected text");
    return framed(utf8(value));
  }
  if (type === "varbytes") return framed(exactHex(value));
  const fixedBytes = /^bytes(\d+)$/.exec(type);
  if (fixedBytes) return exactHex(value, Number(fixedBytes[1]));
  const optional = /^optional<(.+)>$/.exec(type);
  if (optional) {
    return value === null
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), encodeType(optional[1], value)]);
  }
  const arrayType = /^array<(.+)>$/.exec(type);
  if (arrayType) {
    if (!Array.isArray(value)) throw new Error("expected array");
    return Buffer.concat([
      fixedUnsigned(value.length, 4),
      ...value.map((item) => encodeType(arrayType[1], item)),
    ]);
  }
  throw new Error(`unknown provider evidence field type ${type}`);
}

export function productionProviderEvidencePreimage(
  subtype: string,
  input: Record<string, unknown>,
  fixture: Pick<Fixture, "subtype_tags" | "field_schemas">,
): Buffer {
  const tag = fixture.subtype_tags[subtype];
  const schema = fixture.field_schemas[subtype];
  if (!Number.isInteger(tag) || tag < 1 || tag > 255 || !schema) {
    throw new Error(`unknown provider evidence subtype ${subtype}`);
  }
  return Buffer.concat([
    BASE_PREFIX,
    Buffer.from([tag]),
    ...schema.map(([name, type]) => encodeType(type, input[name])),
  ]);
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("definition JSON requires finite safe integers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function definitionPreimage(tag: number, schema: [string, string][]): Buffer {
  return Buffer.concat([
    DEFINITION_PREFIX,
    Buffer.from([tag]),
    framed(utf8(canonicalJson(schema))),
  ]);
}

function domainDefinitionPreimage(commitments: readonly Hex[]): Buffer {
  return Buffer.concat([
    DOMAIN_DEFINITION_PREFIX,
    fixedUnsigned(commitments.length, 4),
    ...commitments.map((value) => exactHex(value, 32)),
  ]);
}

const asHex = (value: Uint8Array): Hex => `0x${Buffer.from(value).toString("hex")}`;
const digest = (value: Uint8Array): Hex => keccak256(asHex(value));

function mutate(subtype: string, input: Record<string, unknown>): Record<string, unknown> {
  const changed = structuredClone(input);
  if (subtype === "safe_head") changed.head_b = (BigInt(changed.head_b as string) + 1n).toString();
  if (subtype === "block") {
    changed.block_number = (BigInt(changed.block_number as string) - 1n).toString();
  }
  if (subtype === "runtime_code") changed.runtime_code_b = "0x6002600055";
  if (subtype === "dynamic_attestation") changed.deployed_source_role = "vesting_wallet";
  if (subtype === "log_coverage") {
    changed.page_commitment = `0x${"ff".repeat(32)}`;
  }
  return changed;
}

function verify(): void {
  const fixture = JSON.parse(
    readFileSync(new URL("./provider-evidence-v2.json", import.meta.url), "utf8"),
  ) as Fixture;
  const commitments: Hex[] = [];
  for (const [subtype, schema] of Object.entries(fixture.field_schemas)) {
    const actual = digest(definitionPreimage(fixture.subtype_tags[subtype], schema));
    if (actual !== fixture.expected_definition_commitments[subtype]) {
      throw new Error(`${subtype} definition commitment mismatch`);
    }
    commitments.push(actual);
  }
  if (digest(domainDefinitionPreimage(commitments)) !== fixture.expected_domain_definition_commitment) {
    throw new Error("provider evidence domain definition commitment mismatch");
  }
  for (const vector of fixture.vectors) {
    const preimage = productionProviderEvidencePreimage(vector.subtype, vector.input, fixture);
    if (asHex(preimage) !== vector.expected_preimage_hex) {
      throw new Error(`${vector.name} preimage mismatch`);
    }
    if (digest(preimage) !== vector.expected_keccak256) {
      throw new Error(`${vector.name} digest mismatch`);
    }
    const mutation = productionProviderEvidencePreimage(
      vector.subtype, mutate(vector.subtype, vector.input), fixture,
    );
    if (digest(mutation) === vector.expected_keccak256) {
      throw new Error(`${vector.name} one-field mutation preserved digest`);
    }
  }
  console.log(`production provider evidence v2: ${fixture.vectors.length} vectors passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) verify();
