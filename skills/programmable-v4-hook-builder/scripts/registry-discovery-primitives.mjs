import crypto from "node:crypto";
import fs from "node:fs";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./submission-core.mjs";
import {
  COMMIT,
  CONTROL_OR_BIDI,
  PROGRAMMABLE_REGISTRY,
  RegistryDiscoveryError,
  SEARCH_STOP_WORDS,
  SLUG,
  UNPAIRED_SURROGATE
} from "./registry-discovery-definitions.mjs";

export const decoder = new TextDecoder("utf-8", { fatal: true });

export async function fetchCanonicalRegistryJson(url, maximumBytes, options) {
  const bytes = await fetchBytes(url, maximumBytes, options);
  const value = parseJsonBytes(bytes, url);
  if (decoder.decode(bytes) !== `${canonicalJson(value)}\n`) fail("REGISTRY_INDEX_INVALID", "Registry index bytes are not canonical");
  return value;
}

export function readCanonicalRegistryJson(file, maximumBytes, label) {
  const bytes = readRegularFile(file, maximumBytes, label);
  const value = parseJsonBytes(bytes, label);
  if (decoder.decode(bytes) !== `${canonicalJson(value)}\n`) fail("REGISTRY_INDEX_INVALID", `${label} bytes are not canonical`);
  return value;
}

export async function fetchJson(url, maximumBytes, options) {
  return parseJsonBytes(await fetchBytes(url, maximumBytes, options), url);
}

export async function fetchBytes(url, maximumBytes, { fetchImplementation, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response || response.status < 200 || response.status >= 300) fail("REGISTRY_NETWORK_UNAVAILABLE", `the live Programmable Registry returned HTTP ${response?.status ?? "unknown"}`);
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) fail("REGISTRY_RESPONSE_TOO_LARGE", "the live Registry response exceeds its byte limit");
    if (response.body?.getReader === undefined) {
      const fallback = Buffer.from(await response.arrayBuffer());
      if (fallback.length < 2 || fallback.length > maximumBytes) fail("REGISTRY_RESPONSE_TOO_LARGE", "the live Registry response exceeds its byte limit");
      return fallback;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        controller.abort();
        fail("REGISTRY_RESPONSE_TOO_LARGE", "the live Registry response exceeds its byte limit");
      }
      chunks.push(Buffer.from(value));
    }
    if (total < 2) fail("REGISTRY_NETWORK_UNAVAILABLE", "the live Registry returned an empty response");
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof RegistryDiscoveryError) throw error;
    fail("REGISTRY_NETWORK_UNAVAILABLE", "the live Programmable Registry could not be reached");
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonBytes(bytes, label) {
  let source;
  try { source = decoder.decode(bytes); } catch { fail("REGISTRY_JSON_INVALID", `${label} is not valid UTF-8 JSON`); }
  try { return parseStrictJson(source); } catch { fail("REGISTRY_JSON_INVALID", `${label} is not closed duplicate-free JSON`); }
}

export function parseStrictJson(source) {
  let cursor = 0;
  let nodes = 0;
  const invalid = () => { throw new SyntaxError("invalid JSON"); };
  const whitespace = () => { while (/[\u0009\u000a\u000d\u0020]/u.test(source[cursor] ?? "")) cursor += 1; };
  const string = () => {
    if (source[cursor] !== "\"") invalid();
    const start = cursor++;
    let escaped = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (!escaped && character === "\"") { cursor += 1; return JSON.parse(source.slice(start, cursor)); }
      if (!escaped && character === "\\") escaped = true; else escaped = false;
      cursor += 1;
    }
    invalid();
  };
  const value = (depth) => {
    nodes += 1;
    if (nodes > 2_000_000 || depth > 128) invalid();
    whitespace();
    if (source[cursor] === "{") {
      cursor += 1; whitespace();
      const output = Object.create(null); const keys = new Set();
      if (source[cursor] === "}") { cursor += 1; return output; }
      while (cursor < source.length) {
        whitespace(); const key = string(); if (keys.has(key)) invalid(); keys.add(key); whitespace();
        if (source[cursor++] !== ":") invalid(); output[key] = value(depth + 1); whitespace();
        if (source[cursor] === "}") { cursor += 1; return output; }
        if (source[cursor++] !== ",") invalid();
      }
      invalid();
    }
    if (source[cursor] === "[") {
      cursor += 1; whitespace(); const output = [];
      if (source[cursor] === "]") { cursor += 1; return output; }
      while (cursor < source.length) {
        output.push(value(depth + 1)); whitespace();
        if (source[cursor] === "]") { cursor += 1; return output; }
        if (source[cursor++] !== ",") invalid();
      }
      invalid();
    }
    if (source[cursor] === "\"") return string();
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, cursor)) { cursor += token.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(cursor));
    if (match) { cursor += match[0].length; const parsed = Number(match[0]); if (!Number.isSafeInteger(parsed)) invalid(); return parsed; }
    invalid();
  };
  const output = value(0); whitespace(); if (cursor !== source.length) invalid(); return output;
}

export function validateTextTree(value, label, depth = 0) {
  if (depth > 64) fail("REGISTRY_TEXT_INVALID", `${label} exceeds the text depth limit`);
  if (typeof value === "string") {
    if (value.length > 4096 || CONTROL_OR_BIDI.test(value) || UNPAIRED_SURROGATE.test(value)) fail("REGISTRY_TEXT_INVALID", `${label} contains unsafe text`);
    return;
  }
  if (Array.isArray(value)) { for (const child of value) validateTextTree(child, label, depth + 1); return; }
  if (isPlainObject(value)) { for (const [key, child] of Object.entries(value)) { validateTextTree(key, label, depth + 1); validateTextTree(child, label, depth + 1); } }
}

export function exactKeys(value, keys, label) {
  if (!isPlainObject(value) || canonicalJson(Object.keys(value).sort(compareUtf8)) !== canonicalJson([...keys].sort(compareUtf8))) fail("REGISTRY_INDEX_INVALID", `${label} has an unexpected shape`);
}

export function assertSortedUnique(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string") || new Set(values).size !== values.length || canonicalJson(values) !== canonicalJson([...values].sort(compareUtf8))) fail("REGISTRY_INDEX_INVALID", `${label} must be a sorted unique string set`);
}

export function requireId(id) { if (!SLUG.test(id ?? "")) fail("REGISTRY_QUERY_INVALID", "project id is invalid", 2); }
export function requireCommit(value, label) { if (!COMMIT.test(value ?? "")) fail("REGISTRY_IDENTITY_MISMATCH", `${label} is invalid`); return value; }
export function requireTimestamp(value, label) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) || Number.isNaN(Date.parse(value))) fail("REGISTRY_SNAPSHOT_INVALID", `${label} is invalid`); }
export function readRegularFile(file, maximumBytes, label) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) fail("REGISTRY_SNAPSHOT_INVALID", `${label} must be a bounded regular file`); return fs.readFileSync(file); }
export function rawUrl(commit, relativePath) { return `${PROGRAMMABLE_REGISTRY.rawRepository}/${commit}/${relativePath}`; }
export function sha256(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
export function tokenize(value) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{Mark}+/gu, "")
    .replace(/\bthree[.\s-]*js\b/gu, "threejs");
  return [...new Set(
    normalized
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 2 && token.length <= 64 && !SEARCH_STOP_WORDS.has(token))
  )].sort(compareUtf8).slice(0, 64);
}
export function difference(left, right) { const other = new Set(right); return left.filter((value) => !other.has(value)); }
export function intersection(left, right) { const other = new Set(right); return left.filter((value) => other.has(value)); }
export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function compareUtf8(left, right) { return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8")); }
export function fail(code, message, exitCode = 1) { throw new RegistryDiscoveryError(code, message, { exitCode }); }
