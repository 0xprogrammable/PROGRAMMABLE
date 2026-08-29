import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

export const BACKEND_REPOSITORY =
  "programmablehq/programmable-open-hook-v2-internal";
export const BACKEND_REPOSITORY_ID = 1_318_883_798;
export const WEBSITE_REPOSITORY = "programmablehq/programmable-evm";
export const WEBSITE_REPOSITORY_ID = 1_314_365_508;
export const BINDING_PATH =
  "services/custom-launch-api-v1/release/public-v3-release-binding-v1.json";
export const PUBLIC_OPENAPI_PATH = "public/openapi/custom-launch-v3.json";
export const LAUNCH_PACKAGE_MANIFEST_PATH = "packages/launch/package.json";
export const OBSERVATION_SCHEMA_VERSION =
  "programmable.custom-launch-api-release-observation.v1";

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_GITHUB_BYTES = 2 * 1024 * 1024;
const PROGRAMMABLE_OPERATOR_ID = 309_941_960;
const PROGRAMMABLE_OPERATOR_LOGIN = "programmable-infra";
const schema = JSON.parse(readFileSync(new URL(
  "../docs/operations/releases/custom-launch-v2/backend-release-binding.schema.json",
  import.meta.url,
), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true })
  .compile(schema);

function githubUrl(path) {
  return new URL(path, "https://api.github.com");
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function requirePattern(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}

async function readGitHubJson(url, token, fetchImpl, signal) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: signal === undefined
        ? AbortSignal.timeout(10_000)
        : AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "programmable-custom-launch-v3-release-verifier",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new Error("Custom Launch API release evidence could not be read", {
      cause: error,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `Custom Launch API release evidence read failed with ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAXIMUM_GITHUB_BYTES) {
    throw new Error("Custom Launch API release evidence response size is invalid");
  }
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Custom Launch API release evidence is not UTF-8 JSON", {
      cause: error,
    });
  }
}

function commitIdentity(value, expectedSha, label, { operator = false } = {}) {
  if (
    value?.sha !== expectedSha
    || value?.commit?.verification?.verified !== true
    || !COMMIT.test(value?.commit?.tree?.sha ?? "")
    || (operator && (
      value?.author?.id !== PROGRAMMABLE_OPERATOR_ID
      || value?.author?.login !== PROGRAMMABLE_OPERATOR_LOGIN
      || value?.committer?.id !== PROGRAMMABLE_OPERATOR_ID
      || value?.committer?.login !== PROGRAMMABLE_OPERATOR_LOGIN
    ))
  ) {
    throw new Error(`${label} lacks exact verified Programmable provenance`);
  }
  return value.commit.tree.sha;
}

function githubFileBytes(contents, expectedPath, expectedBlobSha) {
  if (
    contents?.type !== "file"
    || contents?.path !== expectedPath
    || contents?.encoding !== "base64"
    || typeof contents?.content !== "string"
    || !COMMIT.test(contents?.sha ?? "")
    || (expectedBlobSha !== undefined && contents.sha !== expectedBlobSha)
    || !Number.isSafeInteger(contents?.size)
    || contents.size < 1
    || contents.size > MAXIMUM_GITHUB_BYTES
  ) {
    throw new Error("Custom Launch API binding Git blob metadata is invalid");
  }
  const compact = contents.content.replace(/[\r\n]/gu, "");
  const bytes = Buffer.from(compact, "base64");
  if (
    bytes.length !== contents.size
    || bytes.toString("base64") !== compact
    || gitBlobSha(bytes) !== contents.sha
  ) {
    throw new Error("Custom Launch API binding bytes do not match GitHub metadata");
  }
  return bytes;
}

function canonicalize(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("profile JSON contains an unsupported value");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function parseDeterministicCustomLaunchApiReleaseBindingV1(bytes) {
  const value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (expected.compare(bytes) !== 0) {
    throw new Error("Custom Launch API binding is not deterministic JSON");
  }
  if (!validateSchema(value)) {
    const details = (validateSchema.errors ?? [])
      .map((error) => `${error.instancePath || "$"} ${error.message}`)
      .join("; ");
    throw new Error(`Custom Launch API binding schema is invalid: ${details}`);
  }
  return value;
}

export async function verifyCustomLaunchApiReleaseBindingV1(input) {
  requirePattern(input.attestationCommitSha, COMMIT, "attestation commit");
  requirePattern(input.expectedDocumentSha256, SHA256, "binding digest");
  requirePattern(input.expectedWebsiteCommitSha, COMMIT, "Website commit");
  requirePattern(input.expectedWebsiteTreeSha, COMMIT, "Website tree");
  requirePattern(input.expectedPublicOpenApiSha256, SHA256, "OpenAPI digest");
  requirePattern(
    input.expectedLaunchPackageManifestSha256,
    SHA256,
    "launch package manifest digest",
  );
  if (typeof input.githubToken !== "string" || input.githubToken.length < 1) {
    throw new Error("Custom Launch API release read credential is unavailable");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const [attestationCommit, contents, websiteCommit] = await Promise.all([
    readGitHubJson(
      githubUrl(`/repositories/${BACKEND_REPOSITORY_ID}/commits/${input.attestationCommitSha}?per_page=100`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
    readGitHubJson(
      githubUrl(`/repositories/${BACKEND_REPOSITORY_ID}/contents/${encodedPath(BINDING_PATH)}?ref=${input.attestationCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
    readGitHubJson(
      githubUrl(`/repositories/${WEBSITE_REPOSITORY_ID}/commits/${input.expectedWebsiteCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
  ]);
  commitIdentity(attestationCommit, input.attestationCommitSha, "attestation commit", {
    operator: true,
  });
  if (
    !Array.isArray(attestationCommit.parents)
    || attestationCommit.parents.length !== 1
    || !COMMIT.test(attestationCommit.parents[0]?.sha ?? "")
    || !Array.isArray(attestationCommit.files)
    || attestationCommit.files.length !== 1
    || attestationCommit.files[0]?.filename !== BINDING_PATH
    || !["added", "modified"].includes(attestationCommit.files[0]?.status)
    || attestationCommit.files[0]?.previous_filename !== undefined
  ) {
    throw new Error(
      "Custom Launch API attestation must have one candidate parent and change only its binding",
    );
  }
  const bindingRaw = githubFileBytes(
    contents,
    BINDING_PATH,
    attestationCommit.files?.[0]?.sha,
  );
  const documentSha256 = digest(bindingRaw);
  if (documentSha256 !== input.expectedDocumentSha256) {
    throw new Error("Custom Launch API binding digest does not match");
  }
  const binding = parseDeterministicCustomLaunchApiReleaseBindingV1(bindingRaw);
  const [
    backendCommit,
    publicProfileContents,
    publicOpenApiContents,
    launchPackageManifestContents,
  ] = await Promise.all([
    readGitHubJson(
      githubUrl(`/repositories/${BACKEND_REPOSITORY_ID}/commits/${binding.backend.candidateCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
    readGitHubJson(
      githubUrl(`/repositories/${BACKEND_REPOSITORY_ID}/contents/${encodedPath(binding.api.publicProfilePath)}?ref=${binding.backend.candidateCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
    readGitHubJson(
      githubUrl(`/repositories/${WEBSITE_REPOSITORY_ID}/contents/${encodedPath(PUBLIC_OPENAPI_PATH)}?ref=${binding.website.candidateCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
    readGitHubJson(
      githubUrl(`/repositories/${WEBSITE_REPOSITORY_ID}/contents/${encodedPath(LAUNCH_PACKAGE_MANIFEST_PATH)}?ref=${binding.website.candidateCommitSha}`),
      input.githubToken,
      fetchImpl,
      input.signal,
    ),
  ]);
  const backendTreeSha = commitIdentity(
    backendCommit,
    binding.backend.candidateCommitSha,
    "backend candidate",
  );
  const websiteTreeSha = commitIdentity(
    websiteCommit,
    input.expectedWebsiteCommitSha,
    "Website candidate",
  );
  if (
    attestationCommit.parents[0].sha !== binding.backend.candidateCommitSha
    || backendTreeSha !== binding.backend.candidateTreeSha
    || binding.website.candidateCommitSha !== input.expectedWebsiteCommitSha
    || websiteTreeSha !== input.expectedWebsiteTreeSha
    || binding.website.candidateTreeSha !== input.expectedWebsiteTreeSha
    || binding.website.publicOpenApiSha256 !== input.expectedPublicOpenApiSha256
    || binding.website.launchPackageManifestSha256
      !== input.expectedLaunchPackageManifestSha256
    || binding.fly.imageTag
      !== `main-${binding.backend.candidateCommitSha.slice(0, 12)}`
  ) {
    throw new Error("Custom Launch API binding differs from the exact release subjects");
  }
  const publicProfileRaw = githubFileBytes(
    publicProfileContents,
    binding.api.publicProfilePath,
  );
  let publicProfile;
  try {
    publicProfile = JSON.parse(new TextDecoder("utf8", { fatal: true })
      .decode(publicProfileRaw));
  } catch (error) {
    throw new Error("Custom Launch API public profile is not UTF-8 JSON", {
      cause: error,
    });
  }
  const publicProfileSha256 = digest(Buffer.from(canonicalize(publicProfile), "utf8"));
  if (publicProfileSha256 !== binding.api.publicProfileSha256) {
    throw new Error("Custom Launch API public profile digest does not match its checked-in artifact");
  }
  const publicOpenApiRaw = githubFileBytes(
    publicOpenApiContents,
    PUBLIC_OPENAPI_PATH,
  );
  const launchPackageManifestRaw = githubFileBytes(
    launchPackageManifestContents,
    LAUNCH_PACKAGE_MANIFEST_PATH,
  );
  if (
    digest(publicOpenApiRaw) !== binding.website.publicOpenApiSha256
    || digest(launchPackageManifestRaw)
      !== binding.website.launchPackageManifestSha256
  ) {
    throw new Error("Website release artifact bytes do not match the API release binding");
  }
  return Object.freeze({
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    repository: binding.backend.repository,
    attestationCommitSha: input.attestationCommitSha,
    bindingDocumentPath: BINDING_PATH,
    bindingDocumentSha256: documentSha256,
    backendCandidateCommitSha: binding.backend.candidateCommitSha,
    backendCandidateTreeSha: binding.backend.candidateTreeSha,
    websiteCandidateCommitSha: binding.website.candidateCommitSha,
    websiteCandidateTreeSha: binding.website.candidateTreeSha,
    website: Object.freeze({
      publicOpenApiSha256: binding.website.publicOpenApiSha256,
      launchPackageManifestSha256:
        binding.website.launchPackageManifestSha256,
    }),
    fly: Object.freeze({ ...binding.fly }),
    database: Object.freeze({ ...binding.database }),
    api: Object.freeze({ ...binding.api }),
    chain: Object.freeze({ ...binding.chain }),
    commitSignatureVerified: true,
  });
}
