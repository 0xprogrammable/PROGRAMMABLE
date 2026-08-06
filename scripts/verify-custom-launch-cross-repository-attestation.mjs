import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

export const BACKEND_RELEASE_REPOSITORY =
  "0xprogrammable/programmable-open-hook-v2-internal";
export const BACKEND_RELEASE_BINDING_PATH =
  "services/autonomous-approval-v1/release/cross-repository-release-binding-v1.json";
export const CROSS_REPOSITORY_OBSERVATION_SCHEMA_VERSION =
  "programmable.website-observed-cross-repository-release-binding.v1";

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const BACKEND_SCHEMA = JSON.parse(readFileSync(
  new URL(
    "../docs/operations/releases/custom-launch-v1/backend-cross-repository-release-binding-v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const validateBackendBinding = new Ajv2020({ allErrors: true, strict: true })
  .compile(BACKEND_SCHEMA);

const EXPECTED_COMPONENT_REPOSITORIES = Object.freeze({
  backend: "https://github.com/0xprogrammable/programmable-open-hook-v2-internal",
  website: "https://github.com/0xprogrammable/programmable",
  builderSkill: "https://github.com/0xprogrammable/programmable-v4-builder",
  registrySecurityChecker: "https://github.com/0xprogrammable/programmable-registry",
  productionAuthority: "https://github.com/0xprogrammable/programmable-open-hook-v2-internal",
});

export async function verifyCrossRepositoryReleaseBindingFromGitHubV1(input) {
  requirePattern(input.attestationCommitSha, COMMIT, "attestation commit");
  requirePattern(input.expectedDocumentSha256, SHA256, "binding document SHA-256");
  requirePattern(input.expectedWebsiteCommitSha, COMMIT, "Website commit");
  requirePattern(input.expectedBackendPackageArtifactHash, SHA256, "backend package hash");
  if (typeof input.githubToken !== "string" || input.githubToken.length < 1) {
    throw new Error("Backend release read credential is unavailable.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const commitUrl = githubApiUrl(
    `/repos/${BACKEND_RELEASE_REPOSITORY}/commits/${input.attestationCommitSha}?per_page=100`,
  );
  const contentsUrl = githubApiUrl(
    `/repos/${BACKEND_RELEASE_REPOSITORY}/contents/${encodePath(BACKEND_RELEASE_BINDING_PATH)}`
      + `?ref=${input.attestationCommitSha}`,
  );
  const [commit, contents] = await Promise.all([
    fetchGitHubJson(commitUrl, input.githubToken, fetchImpl, input.signal),
    fetchGitHubJson(contentsUrl, input.githubToken, fetchImpl, input.signal),
  ]);

  const parentCommitSha = validateAttestationCommit(commit, input.attestationCommitSha);
  const documentBytes = validateContentsResponse(contents, commit);
  const documentSha256 = prefixedSha256(documentBytes);
  if (documentSha256 !== input.expectedDocumentSha256) {
    throw new Error("Backend release binding document SHA-256 does not match the release record.");
  }
  const document = parseDeterministicJson(documentBytes);
  if (!validateBackendBinding(document)) {
    throw new Error(`Backend release binding schema validation failed: ${formatSchemaErrors(validateBackendBinding.errors)}`);
  }
  validateComponentRepositories(document);
  if (document.backend.candidateCommitSha !== parentCommitSha) {
    throw new Error("Backend release attestation parent is not the bound backend candidate.");
  }
  if (document.website.candidateCommitSha !== input.expectedWebsiteCommitSha) {
    throw new Error("Backend release binding does not attest the exact Website commit.");
  }
  if (document.backend.packageArtifactHash !== input.expectedBackendPackageArtifactHash) {
    throw new Error("Backend release binding does not attest the exact backend package artifact.");
  }

  return Object.freeze({
    schemaVersion: CROSS_REPOSITORY_OBSERVATION_SCHEMA_VERSION,
    repository: BACKEND_RELEASE_REPOSITORY,
    attestationCommitSha: input.attestationCommitSha,
    parentCommitSha,
    documentPath: BACKEND_RELEASE_BINDING_PATH,
    documentBlobSha: contents.sha,
    documentSha256,
    backendCandidateCommitSha: document.backend.candidateCommitSha,
    backendPackageArtifactHash: document.backend.packageArtifactHash,
    websiteCandidateCommitSha: document.website.candidateCommitSha,
    builderCandidateCommitSha: document.builderSkill.candidateCommitSha,
    registryCandidateCommitSha: document.registrySecurityChecker.candidateCommitSha,
    productionAuthorityCandidateCommitSha:
      document.productionAuthority.candidateCommitSha,
    applicationV3CompatibilityEvidenceSha256: document.compatibility.evidenceSha256,
    commitSignatureVerified: true,
  });
}

async function fetchGitHubJson(url, githubToken, fetchImpl, callerSignal) {
  const timeoutSignal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  const signal = callerSignal === undefined
    ? timeoutSignal
    : AbortSignal.any([callerSignal, timeoutSignal]);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "user-agent": "programmable-custom-launch-release-verifier-v1",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new Error("Backend release evidence could not be read from GitHub.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`Backend release evidence GitHub read failed with status ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("Backend release evidence GitHub response size is invalid.");
  }
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Backend release evidence GitHub response is not valid UTF-8 JSON.", {
      cause: error,
    });
  }
}

function validateAttestationCommit(commit, expectedCommitSha) {
  if (!isObject(commit) || commit.sha !== expectedCommitSha) {
    throw new Error("Backend release attestation commit identity is invalid.");
  }
  if (
    commit.author?.login !== "0xprogrammable"
    || commit.committer?.login !== "0xprogrammable"
    || commit.commit?.verification?.verified !== true
  ) {
    throw new Error("Backend release attestation lacks verified Programmable provenance.");
  }
  if (
    !Array.isArray(commit.parents)
    || commit.parents.length !== 1
    || !COMMIT.test(commit.parents[0]?.sha)
  ) {
    throw new Error("Backend release attestation must have exactly one backend-candidate parent.");
  }
  if (
    !Array.isArray(commit.files)
    || commit.files.length !== 1
    || commit.files[0]?.filename !== BACKEND_RELEASE_BINDING_PATH
    || !["added", "modified"].includes(commit.files[0]?.status)
    || commit.files[0]?.previous_filename !== undefined
    || !COMMIT.test(commit.files[0]?.sha)
  ) {
    throw new Error("Backend release attestation may change only the binding document.");
  }
  return commit.parents[0].sha;
}

function validateContentsResponse(contents, commit) {
  if (
    !isObject(contents)
    || contents.type !== "file"
    || contents.path !== BACKEND_RELEASE_BINDING_PATH
    || contents.encoding !== "base64"
    || !COMMIT.test(contents.sha)
    || contents.sha !== commit.files[0].sha
    || typeof contents.content !== "string"
    || !Number.isSafeInteger(contents.size)
    || contents.size < 1
    || contents.size > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error("Backend release binding Git blob metadata is invalid.");
  }
  const compact = contents.content.replace(/[\r\n]/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)) {
    throw new Error("Backend release binding Git blob encoding is invalid.");
  }
  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.length !== contents.size
    || bytes.toString("base64") !== compact
    || gitBlobSha1(bytes) !== contents.sha
  ) {
    throw new Error("Backend release binding Git blob bytes do not match GitHub metadata.");
  }
  return bytes;
}

function parseDeterministicJson(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Backend release binding is not valid UTF-8 JSON.", { cause: error });
  }
  const deterministic = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (deterministic.compare(bytes) !== 0) {
    throw new Error("Backend release binding does not use deterministic JSON encoding.");
  }
  return value;
}

function validateComponentRepositories(document) {
  for (const [component, expected] of Object.entries(EXPECTED_COMPONENT_REPOSITORIES)) {
    if (normalizeRepositoryUrl(document[component].repositoryUrl) !== expected) {
      throw new Error(`Backend release binding ${component} repository is not canonical.`);
    }
  }
}

function normalizeRepositoryUrl(value) {
  return value.trim().replace(/\.git$/u, "").replace(/\/$/u, "").toLowerCase();
}

function githubApiUrl(path) {
  return new URL(path, "https://api.github.com");
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function prefixedSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function requirePattern(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatSchemaErrors(errors) {
  return (errors ?? []).map((error) => {
    const path = error.instancePath.length === 0 ? "$" : `$${error.instancePath}`;
    return `${path} ${error.message ?? error.keyword}`;
  }).join("; ");
}
