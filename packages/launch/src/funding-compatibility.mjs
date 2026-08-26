import path from "node:path";

import { keccak256, stringToHex } from "viem";

import {
  FUNDING_AUTHORIZATION_METHOD,
  FUNDING_INTENT_HASH_DOMAIN,
  FUNDING_NONCE_DOMAIN,
} from "./constants.mjs";
import { createCliWarning } from "./diagnostics.mjs";

const DOMAIN_ASSIGNMENT = /\b(?:bytes32|string)\s+(?:(?:public|private|internal)\s+)?constant\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]{1,512});/gu;
const IMPORT_SPECIFIER = /\bimport\s+(?:(?:[^;"']*?)\s+from\s+)?["']([^"']+)["']\s*;/gu;
const HEX32 = /^0x[0-9a-fA-F]{64}$/u;

export function inspectEip3009FundingCompatibility({
  launchProfileSelection,
  targets,
  unitsById,
}) {
  if (launchProfileSelection.fundingMode !== FUNDING_AUTHORIZATION_METHOD) return [];
  const targetId = launchProfileSelection.targetRoles.initializerTargetId;
  const initializer = targets.find((target) => target.targetId === targetId);
  if (!initializer) return [];
  const unit = unitsById.get(initializer.compilationUnitId);
  if (!unit) return [];
  const sources = unit.standardJsonInput.sources;
  const reachable = reachableSources(initializer.sourcePath, sources);
  const candidates = [...reachable].flatMap((sourcePath) =>
    domainCandidates(sourcePath, sources[sourcePath].content, reachable, sources));
  const conflicting = candidates.filter(({ kind, observedDomain, observedDomainHash }) => {
    const expectedDomain = kind === "funding-intent"
      ? FUNDING_INTENT_HASH_DOMAIN
      : FUNDING_NONCE_DOMAIN;
    const expectedDomainHash = keccak256(stringToHex(expectedDomain));
    return observedDomain !== expectedDomain && observedDomainHash !== expectedDomainHash;
  });
  const common = {
    stage: "funding-compatibility",
    targetId,
    targetRole: "initializer",
    expected: {
      fundingIntentDomain: FUNDING_INTENT_HASH_DOMAIN,
      fundingNonceDomain: FUNDING_NONCE_DOMAIN,
      fundingCommitment: "launchIntentHash",
      signatureConsumer: "initializer must consume the API-derived EIP-3009 descriptor",
    },
  };
  if (conflicting.length !== 0) {
    return [createCliWarning({
      code: "FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED",
      ...common,
      sourcePath: conflicting[0].sourcePath,
      summary: "Exact initializer sources contain a project-specific funding intent or nonce domain; prove that the API-derived EIP-3009 nonce reaches receiveWithAuthorization before submit.",
      observed: {
        confidence: "source-indicator-only",
        blocking: false,
        indicators: conflicting,
        executionGate: "exact Router simulation",
      },
    })];
  }
  return [createCliWarning({
    code: "FUNDING_NONCE_CONFORMANCE_UNPROVEN",
    ...common,
    sourcePath: initializer.sourcePath,
    summary: "The packer cannot prove from Standard JSON input alone that the initializer consumes the API-derived EIP-3009 nonce.",
    observed: {
      confidence: "unproven",
      blocking: false,
      matchingDomainIndicators: candidates,
      executionGate: "exact Router simulation",
    },
  })];
}

function reachableSources(entrypoint, sources) {
  const reached = new Set();
  const pending = [entrypoint];
  while (pending.length !== 0) {
    const sourcePath = pending.shift();
    if (reached.has(sourcePath) || !Object.hasOwn(sources, sourcePath)) continue;
    reached.add(sourcePath);
    const source = stripSolidityComments(sources[sourcePath].content);
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const resolved = resolveImport(sourcePath, match[1], sources);
      if (resolved !== null && !reached.has(resolved)) pending.push(resolved);
    }
  }
  return [...reached].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function resolveImport(importer, specifier, sources) {
  if (Object.hasOwn(sources, specifier)) return specifier;
  if (!specifier.startsWith(".")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return Object.hasOwn(sources, resolved) ? resolved : null;
}

function domainCandidates(sourcePath, originalSource, reachable, sources) {
  const source = stripSolidityComments(originalSource);
  const combined = [...reachable].map((candidate) =>
    stripSolidityComments(sources[candidate].content)).join("\n");
  const candidates = [];
  for (const match of source.matchAll(DOMAIN_ASSIGNMENT)) {
    const [, identifier, expression] = match;
    const kind = domainKind(identifier);
    if (kind === null || identifierOccurrences(combined, identifier) < 2) continue;
    const observed = observedDomain(expression);
    if (observed === null) continue;
    candidates.push({
      kind,
      identifier,
      sourcePath,
      line: 1 + source.slice(0, match.index).split("\n").length - 1,
      ...observed,
    });
  }
  return candidates;
}

function domainKind(identifier) {
  const normalized = identifier.toUpperCase();
  if (normalized.includes("FUNDING") && normalized.includes("INTENT")
    && (normalized.includes("DOMAIN") || normalized.includes("TYPEHASH"))) {
    return "funding-intent";
  }
  if (normalized.includes("NONCE")
    && (normalized.includes("FUNDING") || normalized.includes("AUTHORIZATION"))
    && (normalized.includes("DOMAIN") || normalized.includes("TYPEHASH"))) {
    return "funding-nonce";
  }
  return null;
}

function observedDomain(expression) {
  const stringMatch = /"([^"\\]*(?:\\.[^"\\]*)*)"/u.exec(expression);
  if (stringMatch !== null && !stringMatch[1].includes("\\")) {
    return {
      observedDomain: stringMatch[1],
      observedDomainHash: keccak256(stringToHex(stringMatch[1])),
    };
  }
  const hashMatch = /0x[0-9a-fA-F]{64}/u.exec(expression);
  if (hashMatch !== null && HEX32.test(hashMatch[0])) {
    return { observedDomain: null, observedDomainHash: hashMatch[0].toLowerCase() };
  }
  return null;
}

function identifierOccurrences(source, identifier) {
  const pattern = new RegExp(`\\b${escapeRegex(identifier)}\\b`, "gu");
  return [...source.matchAll(pattern)].length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripSolidityComments(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code" && current === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line-comment";
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
      continue;
    }
    if (state === "line-comment") {
      output += current === "\n" ? "\n" : " ";
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    output += current;
  }
  return output;
}
