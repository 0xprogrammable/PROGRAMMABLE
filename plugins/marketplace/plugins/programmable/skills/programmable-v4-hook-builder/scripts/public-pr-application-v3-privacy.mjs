import { canonicalJson } from "./submission-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { parseGitLfsPointer } from "./dependency-pointer-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";
import {
  fatalUtf8Decoder,
  isObject,
  safeRepositoryPath,
  sha256Pattern
} from "./public-pr-application-v3-shared.mjs";

export function scanPublicPrApplicationV3ArtifactBytes({ bytes, path: artifactPath, mediaType }) {
  if (!Buffer.isBuffer(bytes) || typeof artifactPath !== "string" || typeof mediaType !== "string") {
    throw new TypeError("public Application V3 artifact scan inputs are invalid");
  }
  let text;
  try {
    text = fatalUtf8Decoder.decode(bytes);
  } catch {
    return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_ARTIFACT_UTF8_INVALID", candidateKinds: Object.freeze([]) });
  }
  const strings = [];
  if (mediaType === "application/json" || mediaType === "application/schema+json") {
    let document;
    try {
      document = parseBoundedStrictJson(text, {
        maxSourceBytes: Math.max(1, bytes.length),
        maxDepth: 256,
        maxNodes: PUBLIC_TEXT_SCAN_MAX_NODES,
        maxNumberCharacters: Math.max(1, bytes.length)
      });
    } catch (error) {
      if (new Set(["STRICT_JSON_DEPTH_LIMIT", "STRICT_JSON_NODE_LIMIT", "STRICT_JSON_SOURCE_LIMIT"]).has(error?.code)) {
        return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_TEXT_SCAN_LIMIT_EXCEEDED", candidateKinds: Object.freeze([]) });
      }
      return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_ARTIFACT_JSON_INVALID", candidateKinds: Object.freeze([]) });
    }
    const stack = [document];
    let visited = 0;
    while (stack.length > 0) {
      const value = stack.pop();
      visited += 1;
      if (visited > PUBLIC_TEXT_SCAN_MAX_NODES) {
        return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_TEXT_SCAN_LIMIT_EXCEEDED", candidateKinds: Object.freeze([]) });
      }
      if (typeof value === "string") {
        strings.push(value);
      } else if (Array.isArray(value)) {
        if (stack.length + value.length > PUBLIC_TEXT_SCAN_MAX_NODES) {
          return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_TEXT_SCAN_LIMIT_EXCEEDED", candidateKinds: Object.freeze([]) });
        }
        for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
      } else if (isObject(value)) {
        for (const [key, child] of Object.entries(value)) {
          strings.push(key);
          stack.push(child);
        }
      }
    }
  } else {
    strings.push(text);
  }
  const candidates = new Map();
  for (const value of strings) {
    if (Buffer.byteLength(value, "utf8") > PUBLIC_TEXT_SCAN_MAX_STRING_BYTES) {
      return Object.freeze({ valid: false, code: "APPLICATION_PUBLIC_TEXT_SCAN_STRING_LIMIT_EXCEEDED", candidateKinds: Object.freeze([]) });
    }
    for (const candidate of scanSensitiveString(value)) {
      candidates.set(`${candidate.kind}:${candidate.candidateSha256}`, candidate);
    }
  }
  return Object.freeze({
    valid: candidates.size === 0,
    code: candidates.size === 0 ? "APPLICATION_PUBLIC_ARTIFACT_SAFE" : "APPLICATION_PUBLIC_ARTIFACT_SENSITIVE_CANDIDATE",
    candidateKinds: Object.freeze([...new Set([...candidates.values()].map(({ kind }) => kind))].sort()),
    candidateDigests: Object.freeze([...candidates.values()].map(({ candidateSha256 }) => candidateSha256).sort())
  });
}

export function classifyPublicPrApplicationV3GitLfsPointer(bytes) {
  const parsed = parseGitLfsPointer(bytes);
  if (parsed.kind === "ordinary") return "not-pointer";
  return parsed.parseState === "VALID"
    && parsed.representation === "CURRENT"
    && parsed.lineEnding === "LF"
    && parsed.finalLineFeed === true
    && parsed.extensionCount === 0
    ? "canonical-pointer"
    : "pointer-like";
}


const PUBLIC_TEXT_SCAN_MAX_NODES = 250_000;
const PUBLIC_TEXT_SCAN_MAX_STRING_BYTES = 1024 * 1024;
const GIT_LFS_POINTER_INSPECTION_BYTES = 4096;
const publicSensitiveRules = Object.freeze([
  Object.freeze({ kind: "private-key", source: "-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "github-access-token", source: "(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "api-access-token", source: "(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "stripe-secret-key", source: "\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "npm-access-token", source: "\\bnpm_[A-Za-z0-9]{20,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "gitlab-access-token", source: "\\bglpat-[A-Za-z0-9_-]{20,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "google-api-key", source: "\\bAIza[0-9A-Za-z_-]{30,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "aws-temporary-access-key-id", source: "\\bASIA[0-9A-Z]{16}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "huggingface-access-token", source: "\\bhf_[A-Za-z0-9]{30,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "bearer-access-token", source: "\\bBearer[ \\t]+[A-Za-z0-9._~+\\/-]{20,}={0,2}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "evm-private-key", source: "\\b(?:private|wallet|secret)(?:[ _-]?key)?[ \\t]*[:=][ \\t]*(?:0x)?[0-9A-Fa-f]{64}\\b", flags: "giu", capture: 0 }),
  Object.freeze({ kind: "uri-userinfo-credential", source: "\\bhttps?:\\/\\/[^\\s\\/@:]+:[^\\s\\/@]+@[^\\s\\/]+", flags: "giu", capture: 0 }),
  Object.freeze({ kind: "encoded-access-token", source: "\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b", flags: "gu", capture: 0 }),
  Object.freeze({ kind: "explicit-secret-assignment", source: "\\b(?:api(?:[_ -]?key)|secret(?:[_ -]?key)?|access(?:[_ -]?token)|password|private(?:[_ -]?key))\\s*[:=]\\s*\\S{8,}", flags: "giu", capture: 0 }),
  Object.freeze({ kind: "seed-phrase", source: "\\b(?:seed|recovery|mnemonic)(?:\\s+phrase|\\s+words?)?\\s*[:=]\\s*(?:[a-z]{2,12}\\s+){11,23}[a-z]{2,12}\\b", flags: "giu", capture: 0 }),
  Object.freeze({ kind: "private-pii", source: "\\b(?:social security|ssn|passport|national id|tax id|private email|home address)\\s*(?:number)?\\s*[:=]\\s*\\S{4,}", flags: "giu", capture: 0 }),
  Object.freeze({ kind: "financial-identifier", source: "\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\\b", flags: "gu", capture: 0 })
]);

export function validatePublicApplicationText(application, add) {
  const candidates = [];
  const seen = new WeakSet();
  const stack = [{ value: application, path: "$", pointer: "", field: null }];
  let visitedNodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visitedNodes += 1;
    if (visitedNodes > PUBLIC_TEXT_SCAN_MAX_NODES) {
      add(
        "blocker",
        "APPLICATION_PUBLIC_TEXT_SCAN_LIMIT_EXCEEDED",
        "$",
        "The public application exceeds the deterministic privacy-scan node bound.",
        "Split transport evidence without changing the product idea, then rescan every public string before publication.",
        "intent-privacy"
      );
      return;
    }
    if (typeof current.value === "string") {
      const byteLength = Buffer.byteLength(current.value, "utf8");
      if (byteLength > PUBLIC_TEXT_SCAN_MAX_STRING_BYTES) {
        add(
          "blocker",
          "APPLICATION_PUBLIC_TEXT_SCAN_STRING_LIMIT_EXCEEDED",
          current.path,
          "One public string exceeds the deterministic privacy-scan byte bound.",
          "Move oversized evidence into a content-addressed review artifact and keep the public application bounded.",
          "intent-privacy",
          { byteLength, maximumByteLength: PUBLIC_TEXT_SCAN_MAX_STRING_BYTES }
        );
        continue;
      }
      for (const candidate of scanSensitiveString(current.value)) {
        candidates.push({
          ...candidate,
          path: current.path,
          pointer: current.pointer,
          objectKey: false
        });
      }
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) {
      add(
        "blocker",
        "APPLICATION_PUBLIC_TEXT_SCAN_GRAPH_INVALID",
        current.path,
        "The public application contains a repeated or cyclic object graph that cannot be represented as canonical JSON.",
        "Submit one acyclic JSON value and rescan its exact public strings.",
        "intent-privacy"
      );
      continue;
    }
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          pointer: `${current.pointer}/${index}`,
          field: current.field
        });
      }
      continue;
    }
    const keys = Object.keys(current.value).sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      for (const candidate of scanSensitiveString(key)) {
        candidates.push({
          ...candidate,
          path: current.path,
          pointer: null,
          objectKey: true
        });
      }
      stack.push({
        value: current.value[key],
        path: `${current.path}.${jsonPathKey(key)}`,
        pointer: `${current.pointer}/${escapeJsonPointerToken(key)}`,
        field: key
      });
    }
  }

  const attestedFinancialCandidates = validatePublicDisclosureAttestations(application, candidates, add);
  const sensitiveByPath = new Map();
  for (const candidate of candidates) {
    const candidateKey = disclosureCandidateKey(candidate.pointer, candidate.candidateSha256);
    if (
      candidate.kind === "financial-identifier"
      && candidate.objectKey === false
      && attestedFinancialCandidates.has(candidateKey)
    ) {
      add(
        "review",
        "APPLICATION_PUBLIC_FINANCIAL_IDENTIFIER_ATTESTED_REVIEW_REQUIRED",
        candidate.path,
        "An exact content-bound financial identifier is declared intentionally public but remains subject to human review.",
        "Verify the owner-stated purpose and authorization evidence independently; this attestation proves neither ownership nor approval and cannot authorize publication by itself.",
        "intent-privacy-review",
        {
          category: "public-financial-identifier",
          candidatePointer: candidate.pointer,
          candidateSha256: candidate.candidateSha256,
          humanReviewRequired: true,
          ownershipProofClaim: false,
          approvalClaim: false
        }
      );
      continue;
    }
    const kinds = sensitiveByPath.get(candidate.path) ?? new Set();
    kinds.add(candidate.kind);
    sensitiveByPath.set(candidate.path, kinds);
  }

  for (const [findingPath, kinds] of [...sensitiveByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    add(
      "blocker",
      "APPLICATION_PUBLIC_TEXT_SENSITIVE_CANDIDATE",
      findingPath,
      "Potential secret, key, token, seed phrase, private PII, or financial identifier is present in a public application string.",
      "Remove or explicitly redact the private value before public application materialization; keep the underlying idea eligible for review.",
      "intent-privacy",
      { candidateKinds: [...kinds].sort() }
    );
  }
}

function scanSensitiveString(text) {
  const candidates = new Map();
  for (const rule of publicSensitiveRules) {
    const pattern = new RegExp(rule.source, rule.flags);
    for (const match of text.matchAll(pattern)) {
      const rawCandidate = match[rule.capture];
      if (typeof rawCandidate !== "string") continue;
      const candidateSha256 = sha256Bytes(Buffer.from(rawCandidate, "utf8"));
      candidates.set(`${rule.kind}:${candidateSha256}`, { kind: rule.kind, candidateSha256 });
    }
  }
  return [...candidates.values()].sort((left, right) => (
    left.kind.localeCompare(right.kind) || left.candidateSha256.localeCompare(right.candidateSha256)
  ));
}

function validatePublicDisclosureAttestations(application, candidates, add) {
  const validCandidates = new Set();
  const attestations = application?.publicDisclosureAttestations;
  if (attestations === undefined) return validCandidates;
  if (!Array.isArray(attestations)) {
    addInvalidDisclosureAttestation(add, "$.publicDisclosureAttestations");
    return validCandidates;
  }

  const financialCandidates = new Set(candidates
    .filter(({ kind, objectKey, pointer }) => kind === "financial-identifier" && objectKey === false && typeof pointer === "string")
    .map(({ pointer, candidateSha256 }) => disclosureCandidateKey(pointer, candidateSha256)));
  const seenIds = new Set();
  const seenCandidateBindings = new Set();
  const reviewRecords = Array.isArray(application?.reviewPackage?.records) ? application.reviewPackage.records : [];

  for (const [index, attestation] of attestations.entries()) {
    const attestationPath = `$.publicDisclosureAttestations[${index}]`;
    let valid = isObject(attestation);
    if (!valid) {
      addInvalidDisclosureAttestation(add, attestationPath);
      continue;
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(attestation.id ?? "") || seenIds.has(attestation.id)) valid = false;
    else seenIds.add(attestation.id);
    if (attestation.category !== "public-financial-identifier") valid = false;
    if (!canonicalJsonPointer(attestation.candidatePointer)) valid = false;
    if (!sha256Pattern.test(attestation.candidateSha256 ?? "")) valid = false;
    const candidateBinding = disclosureCandidateKey(attestation.candidatePointer, attestation.candidateSha256);
    if (seenCandidateBindings.has(candidateBinding)) valid = false;
    else seenCandidateBindings.add(candidateBinding);
    if (!financialCandidates.has(candidateBinding)) valid = false;
    if (typeof resolveJsonPointer(application, attestation.candidatePointer) !== "string") valid = false;

    if (!isObject(attestation.subject)
      || attestation.subject.applicationId !== application?.applicationId
      || typeof attestation.subject.purpose !== "string"
      || attestation.subject.purpose.trim().length === 0) valid = false;

    const authorization = attestation.authorization;
    if (!isObject(authorization)
      || authorization.provenance !== "owner-stated"
      || authorization.ownerConfirmation !== "confirmed"
      || typeof authorization.evidenceRef !== "string"
      || !safeRepositoryPath(authorization.evidenceRef)
      || !sha256Pattern.test(authorization.evidenceSha256 ?? "")
      || authorization.reviewState !== "human-review-required"
      || authorization.ownershipProofClaim !== false
      || authorization.approvalClaim !== false) valid = false;

    const exactAuthorizationRecords = reviewRecords.filter((record) => (
      record?.kind === "public-disclosure-authorization"
      && record?.path === authorization?.evidenceRef
      && record?.sha256 === authorization?.evidenceSha256
    ));
    if (exactAuthorizationRecords.length !== 1) valid = false;

    if (!valid) {
      addInvalidDisclosureAttestation(add, attestationPath);
      continue;
    }
    validCandidates.add(candidateBinding);
  }
  return validCandidates;
}

function addInvalidDisclosureAttestation(add, findingPath) {
  add(
    "blocker",
    "APPLICATION_PUBLIC_TEXT_DISCLOSURE_ATTESTATION_INVALID",
    findingPath,
    "A public-disclosure attestation is malformed, duplicated, unbound, or does not target one exact financial-identifier candidate.",
    "Bind one owner-confirmed, human-review-required authorization record to the exact JSON Pointer and SHA-256 candidate digest; secrets, keys, credentials and tokens are never attestable.",
    "intent-privacy"
  );
}

function disclosureCandidateKey(pointer, candidateSha256) {
  return `${pointer ?? "<object-key>"}:${candidateSha256 ?? "<invalid>"}`;
}

function canonicalJsonPointer(value) {
  return typeof value === "string" && /^(?:\/(?:[^~\/]|~[01])*)+$/u.test(value);
}

function resolveJsonPointer(root, pointer) {
  if (!canonicalJsonPointer(pointer)) return undefined;
  let current = root;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = encodedToken.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
      current = current[index];
    } else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function escapeJsonPointerToken(value) {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function jsonPathKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : `[${JSON.stringify(key)}]`;
}

export function findingsHavePrivacyHold(findings) {
  return findings.some(({ code }) => code.startsWith("APPLICATION_PUBLIC_TEXT_"));
}

export function privacySafeReport(report) {
  const privacyFindings = report.findings
    .filter(({ code }) => code.startsWith("APPLICATION_PUBLIC_TEXT_"))
    .map((finding) => ({
      severity: "blocker",
      code: finding.code,
      path: "$",
      message: finding.message,
      remediation: finding.remediation,
      classification: "intent-privacy",
      ...(Array.isArray(finding.candidateKinds) ? { candidateKinds: [...finding.candidateKinds] } : {})
    }));
  const uniqueFindings = [];
  const seen = new Set();
  for (const finding of privacyFindings) {
    const identity = `${finding.code}:${canonicalJson(finding.candidateKinds ?? [])}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueFindings.push(finding);
  }
  return {
    ...report,
    valid: false,
    status: "HELD_FOR_PRIVACY_REDACTION",
    counts: { blocker: uniqueFindings.length, review: 0 },
    findings: uniqueFindings,
    publicApplicationEligibility: "HELD_FOR_PRIVACY_REDACTION",
    privacyDiagnosticsSuppressed: true
  };
}

export function privacySafeSecuritySummary(report) {
  return {
    schemaVersion: report?.schemaVersion ?? "open-world-security-v1",
    assessmentState: report?.assessmentState ?? "invalid",
    ideaEligibility: report?.ideaEligibility ?? "PRESERVED",
    implementationAuthorization: "NOT_GRANTED",
    route: report?.route ?? "CHANGES_REQUIRED",
    summary: isObject(report?.summary) ? { ...report.summary } : {},
    findingsSuppressedForPrivacy: true
  };
}
