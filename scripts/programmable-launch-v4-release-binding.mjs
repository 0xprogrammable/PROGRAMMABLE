import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { keccak256, stringToHex } from "viem";

import {
  normalizeV4ChainDeployment,
  normalizeV4ProfileRef,
} from "../packages/launch/src/v4-contract.mjs";

export const V4_RELEASE_BINDING_SCHEMA =
  "programmable.launch-cli-v4-release-binding.v1";
export const V4_RELEASE_BINDING_PATH =
  "docs/operations/releases/custom-launch-v4/cli-release-binding.json";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const HEX40 = /^[0-9a-f]{40}$/u;
const FOUNDATION =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const CHAIN = Object.freeze({
  chainId: "4663",
  caip2: "eip155:4663",
  chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
});
const PACKAGE = Object.freeze({
  name: "@programmable/launch",
  version: "4.0.0",
  tag: "programmable-launch-v4.0.0",
  repository: "programmablehq/PROGRAMMABLE",
});
const PROFILE = Object.freeze({
  schemaVersion: "programmable.custom-launch-profile-ref.v4",
  structuralProfileId: "programmable.custom-launch.robinhood-mainnet.v1",
  businessProfileId: "robinhood-production-launch",
  admissionDescriptorDigest:
    "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948",
  admissionPolicyDigest:
    "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216",
  admissionBindingDigest:
    "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2",
  admissionSchemaDigest:
    "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
  profileRevision: 1,
  profileVersion: "4.0.0",
  profileDigest:
    "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
});
const FINALITY_POLICY = Object.freeze({
  schemaVersion: "programmable.custom-launch-finality-policy-ref.v1",
  policyId: "robinhood-stage-finality-v1",
  policyRevision: 1,
  policyDigest:
    "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
});
const POLICY_SOURCE = Object.freeze({
  schemaVersion: "programmable.custom-launch-policy-source.v1",
  repository: "programmablehq/Launch-Policy",
  repositoryId: 1_320_171_831,
  protectedBranch: "main",
  verifiedMergeCommit: "987215867472229690e30e11000c626d58f46e16",
  verifiedTree: "284fb19f05cdf9b5b60b8bacfbd480f6b98decd3",
  artifacts: Object.freeze({
    descriptor: Object.freeze({
      path: "policy/custom-launch-admission-v4.json",
      digest: PROFILE.admissionDescriptorDigest,
    }),
    businessPolicy: Object.freeze({
      path: "policy/launch-policy.v1.json",
      digest: PROFILE.admissionPolicyDigest,
    }),
    generatedBinding: Object.freeze({
      path: ".programmable/custom-launch-admission.v4.json",
      digest: PROFILE.admissionBindingDigest,
    }),
    schema: Object.freeze({
      path: "policy/schemas/custom-launch-admission-v4.schema.json",
      digest: PROFILE.admissionSchemaDigest,
    }),
  }),
});
const RELEASE_IDENTITY = Object.freeze({
  package: PACKAGE,
  profile: PROFILE,
  finalityPolicy: FINALITY_POLICY,
  policySource: POLICY_SOURCE,
});
const SCHEMAS = Object.freeze({
  chainDeployment: "programmable.launch-cli-v4-chain-deployment-binding.v1",
  profile: "programmable.launch-cli-v4-profile-evidence.v1",
  manifest: "programmable.launch-cli-v4-release-manifest.v1",
  source: "programmable.launch-cli-v4-source-closure.v1",
  finality: "programmable.launch-cli-v4-finality-evidence.v1",
});
export const V4_RELEASE_REQUIRED_SOURCE_PATHS = Object.freeze([
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
  "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
  "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
]);
const MACHINES = Object.freeze({
  openapi: ["public/openapi/custom-launch-v4.json",
    "https://programmable.market/openapi/custom-launch-v4.json"],
  packConfig: ["public/schemas/custom-launch/v4/pack-config.json",
    "https://programmable.market/schemas/custom-launch/v4/pack-config.json"],
  createRequest: ["public/schemas/custom-launch/v4/custom-launch-create-request.json",
    "https://programmable.market/schemas/custom-launch/v4/custom-launch-create-request.json"],
  resource: ["public/schemas/custom-launch/v4/custom-launch.json",
    "https://programmable.market/schemas/custom-launch/v4/custom-launch.json"],
  capabilities: ["public/schemas/custom-launch/v4/capabilities.json",
    "https://programmable.market/schemas/custom-launch/v4/capabilities.json"],
  preflight: ["public/schemas/custom-launch/v4/preflight.json",
    "https://programmable.market/schemas/custom-launch/v4/preflight.json"],
  onchainEvidence: ["public/schemas/custom-launch/v4/onchain-evidence.json",
    "https://programmable.market/schemas/custom-launch/v4/onchain-evidence.json"],
  exactWalletTransaction: ["public/schemas/custom-launch/v4/exact-wallet-transaction.json",
    "https://programmable.market/schemas/custom-launch/v4/exact-wallet-transaction.json"],
});

export function auditV4ReleaseBinding({
  repositoryRoot,
  bindingPath = V4_RELEASE_BINDING_PATH,
}) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const bytes = readFileSync(inside(root, bindingPath));
  const binding = JSON.parse(bytes.toString("utf8"));
  keys(binding, ["$schema", "schemaVersion", "releaseReady", "releaseIdentity",
    "chain", "machineContracts", "evidence", "blockers"], "binding");
  equal(binding.$schema, "./cli-release-binding.schema.json", "$schema");
  equal(binding.schemaVersion, V4_RELEASE_BINDING_SCHEMA, "schemaVersion");
  if (typeof binding.releaseReady !== "boolean") throw new Error("releaseReady type is invalid");
  deep(binding.releaseIdentity, RELEASE_IDENTITY, "releaseIdentity");
  normalizeV4ProfileRef(binding.releaseIdentity.profile);
  keys(binding.chain, ["chainId", "caip2", "chainDeploymentId",
    "chainDeploymentDescriptorDigest"], "chain");
  chain(binding.chain, "chain");
  optional(binding.chain.chainDeploymentDescriptorDigest, HEX32, "chain descriptor digest");
  const machineContracts = auditMachines(root, binding.machineContracts);
  keys(binding.evidence, ["chainDeployment", "profile", "manifest", "source", "finality"],
    "evidence");
  for (const [name, value] of Object.entries(binding.evidence)) {
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`evidence.${name} must be null or a closed evidence object`);
    }
  }
  const deployment = binding.evidence.chainDeployment === null ? null
    : auditDeployment(binding.evidence.chainDeployment);
  const profile = binding.evidence.profile === null ? null
    : auditProfile(binding.evidence.profile, deployment);
  const source = binding.evidence.source === null ? null
    : auditSource(root, binding.evidence.source);
  const finality = binding.evidence.finality === null ? null
    : auditFinality(binding.evidence.finality, deployment);
  const manifest = binding.evidence.manifest === null ? null
    : auditManifest(binding.evidence.manifest,
      { deployment, profile, source, finality, machineContracts });
  if (deployment !== null) {
    equal(binding.chain.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "chain deployment descriptor evidence");
  }
  const blockers = [
    ...(deployment === null ? ["chainDeploymentEvidence"] : []),
    ...(profile === null ? ["profileEvidence"] : []),
    ...(manifest === null ? ["releaseManifestEvidence"] : []),
    ...(source === null ? ["sourceClosureEvidence"] : []),
    ...(finality === null ? ["finalityEvidence"] : []),
  ];
  if (!Array.isArray(binding.blockers)
    || binding.blockers.some((item) => typeof item !== "string" || item.length === 0)
    || new Set(binding.blockers).size !== binding.blockers.length) {
    throw new Error("blockers must be a unique string array");
  }
  deep(binding.blockers, blockers, "blockers");
  equal(binding.releaseReady, blockers.length === 0, "releaseReady");
  return Object.freeze({ binding, bindingPath, bindingSha256: sha(bytes),
    releaseReady: binding.releaseReady, blockers: Object.freeze([...binding.blockers]) });
}

export function requireV4ReleaseReady(options) {
  const result = auditV4ReleaseBinding(options);
  if (!result.releaseReady) {
    throw new Error(`V4 release binding is blocked: ${result.blockers.join(", ")}`);
  }
  return result;
}

export function computeV4ChainDeploymentDescriptorDigest(value) {
  return keccak256(stringToHex(canonical(value)));
}
export const computeV4ChainDeploymentBindingDigest = (value) =>
  evidenceSha(SCHEMAS.chainDeployment, omit(value, "bindingDigest"));
export const computeV4ProfileEvidenceDigest = (value) =>
  evidenceSha(SCHEMAS.profile, omit(value, "profileEvidenceDigest"));
export const computeV4ReleaseManifestDigest = (value) =>
  evidenceSha(SCHEMAS.manifest, omit(value, "releaseManifestDigest"));
export const computeV4SourceClosureDigest = (value) =>
  evidenceSha(SCHEMAS.source, omit(value, "sourceClosureDigest"));
export const computeV4FinalityEvidenceDigest = (value) =>
  evidenceSha(SCHEMAS.finality, omit(value, "finalityEvidenceDigest"));

function auditMachines(root, values) {
  if (!Array.isArray(values) || values.length !== Object.keys(MACHINES).length) {
    throw new Error("machineContracts must bind every V4 public artifact");
  }
  const result = values.map((entry) => {
    keys(entry, ["name", "path", "url", "sha256"], "machineContracts entry");
    const expected = MACHINES[entry.name];
    if (expected === undefined) throw new Error(`unexpected machine contract ${entry.name}`);
    equal(entry.path, expected[0], `${entry.name}.path`);
    equal(entry.url, expected[1], `${entry.name}.url`);
    required(entry.sha256, SHA256, `${entry.name}.sha256`);
    equal(entry.sha256, sha(readFileSync(inside(root, entry.path))), `${entry.name}.sha256`);
    return { name: entry.name, sha256: entry.sha256 };
  });
  deep(result.map(({ name }) => name), Object.keys(MACHINES), "machineContracts order");
  return result;
}

function auditDeployment(value) {
  keys(value, ["schemaVersion", "descriptor", "descriptorDigest", "bindingDigest"],
    "evidence.chainDeployment");
  equal(value.schemaVersion, SCHEMAS.chainDeployment, "deployment binding schemaVersion");
  const normalized = normalizeV4ChainDeployment(value.descriptor);
  deep(value.descriptor, normalized, "deployment descriptor normalization");
  deep(value.descriptor.finality, FINALITY_POLICY, "deployment finality policy");
  equal(value.descriptor.foundationSourceCommitment, FOUNDATION,
    "deployment foundation source commitment");
  assertPerContractProvenance(value.descriptor);
  required(value.descriptorDigest, HEX32, "deployment descriptor digest");
  equal(value.descriptorDigest, computeV4ChainDeploymentDescriptorDigest(value.descriptor),
    "deployment descriptor digest");
  required(value.bindingDigest, SHA256, "deployment binding digest");
  equal(value.bindingDigest, computeV4ChainDeploymentBindingDigest(value),
    "deployment binding digest");
  return value;
}

function assertPerContractProvenance(descriptor) {
  deep(descriptor.deploymentEvidence.sourceVerification, {
    sourcifyExactMatchCoveredContracts: ["programmableLaunchStampRouter", "graphFactory"],
    officialSourcePinnedCoveredContracts: ["permitAuthority"],
  }, "atomic per-contract source provenance");
  equal(descriptor.permitAuthoritySourceProvenance.sourceCommitment,
    "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
    "Safe pinned source provenance");
  equal(descriptor.permit2GenesisProvenance.startBlock, "0", "Permit2 genesis startBlock");
  equal(descriptor.permit2GenesisProvenance.genesisSourceDigest,
    "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba",
    "Permit2 genesis source");
  for (const evidence of descriptor.externalRootDeploymentEvidence) {
    equal(evidence.registrySource.sha256,
      "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
      `${evidence.contract} registry source`);
  }
}

function auditProfile(value, deployment) {
  keys(value, ["schemaVersion", "profile", "chainDeploymentDescriptorDigest",
    "fundingModes", "capabilities", "profileEvidenceDigest"], "evidence.profile");
  equal(value.schemaVersion, SCHEMAS.profile, "profile evidence schemaVersion");
  deep(value.profile, PROFILE, "profile evidence frozen tuple");
  normalizeV4ProfileRef(value.profile);
  required(value.chainDeploymentDescriptorDigest, HEX32, "profile deployment digest");
  deep(value.fundingModes, ["none", "wallet-transaction-value"], "profile funding modes");
  keys(value.capabilities, ["feeBehaviorClaim", "universalFeeBehaviorClaim",
    "genericClaimingLive", "buybacksLive"], "profile capabilities");
  deep(value.capabilities, { feeBehaviorClaim: false, universalFeeBehaviorClaim: false,
    genericClaimingLive: false, buybacksLive: false }, "profile capabilities");
  required(value.profileEvidenceDigest, SHA256, "profile evidence digest");
  equal(value.profileEvidenceDigest, computeV4ProfileEvidenceDigest(value),
    "profile evidence digest");
  if (deployment !== null) {
    equal(value.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "profile/deployment digest");
  }
  return value;
}

function auditSource(root, value) {
  keys(value, ["schemaVersion", "repository", "branch", "revision", "tree",
    "foundationSourceCommitment", "entries", "sourceClosureDigest"], "evidence.source");
  equal(value.schemaVersion, SCHEMAS.source, "source schemaVersion");
  equal(value.repository, PACKAGE.repository, "source repository");
  equal(value.branch, "production", "source branch");
  if (!HEX40.test(value.revision) || !HEX40.test(value.tree)) {
    throw new Error("source revision and tree are invalid");
  }
  equal(git(root, ["rev-parse", "--verify", `${value.revision}^{commit}`])
    .toString("utf8").trim(), value.revision, "source Git revision");
  equal(git(root, ["rev-parse", `${value.revision}^{tree}`]).toString("utf8").trim(),
    value.tree, "source Git tree");
  git(root, ["merge-base", "--is-ancestor", value.revision, "refs/heads/production"]);
  equal(value.foundationSourceCommitment, FOUNDATION, "source foundation commitment");
  if (!Array.isArray(value.entries)
    || value.entries.length < V4_RELEASE_REQUIRED_SOURCE_PATHS.length) {
    throw new Error("source closure is incomplete");
  }
  const paths = value.entries.map((entry, index) => {
    keys(entry, ["path", "byteLength", "sha256"], `source entry ${index}`);
    const bytes = readFileSync(inside(root, entry.path));
    if (!bytes.equals(git(root, ["show", `${value.revision}:${entry.path}`]))) {
      throw new Error(`source entry ${entry.path} differs from its bound Git revision`);
    }
    if (typeof entry.byteLength !== "string" || !/^[1-9][0-9]*$/u.test(entry.byteLength)
      || BigInt(entry.byteLength) !== BigInt(bytes.byteLength)) {
      throw new Error(`source entry ${entry.path} byteLength differs`);
    }
    required(entry.sha256, SHA256, `source entry ${entry.path} sha256`);
    equal(entry.sha256, sha(bytes), `source entry ${entry.path} sha256`);
    return entry.path;
  });
  if (new Set(paths).size !== paths.length || paths.some((item, index) => index > 0
    && Buffer.compare(Buffer.from(paths[index - 1]), Buffer.from(item)) >= 0)) {
    throw new Error("source paths are not unique UTF-8 order");
  }
  for (const requiredPath of V4_RELEASE_REQUIRED_SOURCE_PATHS) {
    if (!paths.includes(requiredPath)) throw new Error(`source closure misses ${requiredPath}`);
  }
  required(value.sourceClosureDigest, SHA256, "source closure digest");
  equal(value.sourceClosureDigest, computeV4SourceClosureDigest(value),
    "source closure digest");
  return value;
}

function auditFinality(value, deployment) {
  keys(value, ["schemaVersion", "chainDeploymentDescriptorDigest",
    "deploymentTransactionHash", "l2Checkpoint", "ethereumFinalityEvidence",
    "finalityEvidenceDigest"], "evidence.finality");
  equal(value.schemaVersion, SCHEMAS.finality, "finality schemaVersion");
  required(value.chainDeploymentDescriptorDigest, HEX32, "finality descriptor digest");
  required(value.deploymentTransactionHash, HEX32, "finality deployment transaction");
  keys(value.l2Checkpoint, ["blockNumber", "blockHash"], "finality l2Checkpoint");
  positive(value.l2Checkpoint.blockNumber, "finality L2 block");
  required(value.l2Checkpoint.blockHash, HEX32, "finality L2 block hash");
  required(value.finalityEvidenceDigest, SHA256, "finality evidence digest");
  equal(value.finalityEvidenceDigest, computeV4FinalityEvidenceDigest(value),
    "finality evidence digest");
  if (deployment !== null) {
    const atomic = deployment.descriptor.deploymentEvidence;
    equal(value.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "finality/deployment descriptor digest");
    equal(value.deploymentTransactionHash, atomic.transactionHash,
      "finality/deployment transaction");
    deep(value.l2Checkpoint, { blockNumber: atomic.blockNumber, blockHash: atomic.blockHash },
      "finality/deployment L2 checkpoint");
    deep(value.ethereumFinalityEvidence, atomic.ethereumFinalityEvidence,
      "finality/deployment Ethereum evidence");
    deep(value.ethereumFinalityEvidence,
      deployment.descriptor.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence,
      "finality/Safe Ethereum evidence");
  }
  return value;
}

function auditManifest(value, deps) {
  keys(value, ["schemaVersion", "releaseIdentity", "chainId", "caip2",
    "chainDeploymentId", "chainDeploymentDescriptorDigest",
    "chainDeploymentBindingDigest", "profileEvidenceDigest", "sourceRevision",
    "sourceTree", "sourceClosureDigest", "deploymentTransactionHash",
    "deploymentBlockHash", "finalityEvidenceDigest", "machineContracts",
    "releaseManifestDigest"], "evidence.manifest");
  if (Object.values(deps).some((item) => item === null)) {
    throw new Error("release manifest requires every evidence binding");
  }
  equal(value.schemaVersion, SCHEMAS.manifest, "manifest schemaVersion");
  deep(value.releaseIdentity, RELEASE_IDENTITY, "manifest release identity");
  chain(value, "manifest");
  equal(value.chainDeploymentDescriptorDigest, deps.deployment.descriptorDigest,
    "manifest descriptor digest");
  equal(value.chainDeploymentBindingDigest, deps.deployment.bindingDigest,
    "manifest deployment binding digest");
  equal(value.profileEvidenceDigest, deps.profile.profileEvidenceDigest,
    "manifest profile evidence digest");
  equal(value.sourceRevision, deps.source.revision, "manifest source revision");
  equal(value.sourceTree, deps.source.tree, "manifest source tree");
  equal(value.sourceClosureDigest, deps.source.sourceClosureDigest, "manifest source digest");
  equal(value.deploymentTransactionHash,
    deps.deployment.descriptor.deploymentEvidence.transactionHash,
    "manifest deployment transaction");
  equal(value.deploymentBlockHash, deps.deployment.descriptor.deploymentEvidence.blockHash,
    "manifest deployment block");
  equal(value.finalityEvidenceDigest, deps.finality.finalityEvidenceDigest,
    "manifest finality digest");
  deep(value.machineContracts, deps.machineContracts, "manifest machine contracts");
  required(value.releaseManifestDigest, SHA256, "manifest digest");
  equal(value.releaseManifestDigest, computeV4ReleaseManifestDigest(value), "manifest digest");
  return value;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["audit", "verify-release-ready"]).has(command) || rest.length % 2 !== 0) {
    throw new Error("Usage: programmable-launch-v4-release-binding.mjs "
      + "<audit|verify-release-ready> --repository-root PATH [--binding PATH]");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!new Set(["--repository-root", "--binding"]).has(rest[index])
      || values.has(rest[index])) throw new Error("invalid V4 release-binding argument");
    values.set(rest[index], rest[index + 1]);
  }
  if (!values.has("--repository-root")) throw new Error("Missing --repository-root");
  return { command, repositoryRoot: values.get("--repository-root"),
    bindingPath: values.get("--binding") ?? V4_RELEASE_BINDING_PATH };
}

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const evidenceSha = (domain, value) => sha(Buffer.concat([
  Buffer.from(domain), Buffer.from([0]), Buffer.from(canonical(value)),
]));
function omit(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("evidence preimage must be an object");
  }
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical JSON number is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new Error("canonical JSON value is invalid");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function inside(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative)
    || relative.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("release binding path is invalid");
  }
  const result = path.resolve(root, relative);
  if (!result.startsWith(`${root}${path.sep}`)) throw new Error("release binding path escapes root");
  const info = lstatSync(result);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("release binding path is not a regular file");
  }
  const physical = realpathSync(result);
  if (!physical.startsWith(`${root}${path.sep}`)) throw new Error("release binding path escapes root");
  return result;
}
function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`source Git binding failed for ${args[0]}: `
      + result.stderr.toString("utf8").trim());
  }
  return result.stdout;
}
function keys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || canonical(Object.keys(value).sort()) !== canonical([...expected].sort())) {
    throw new Error(`${label} fields do not match the closed V4 release binding`);
  }
}
function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} does not match the closed V4 release binding`);
  }
}
function deep(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${label} does not match the closed V4 release binding`);
  }
}
function required(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
}
function optional(value, pattern, label) {
  if (value !== null) required(value, pattern, label);
}
function positive(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)
    || BigInt(value) >= 1n << 256n) throw new Error(`${label} is not a positive uint256`);
}
function chain(value, label) {
  equal(value.chainId, CHAIN.chainId, `${label}.chainId`);
  equal(value.caip2, CHAIN.caip2, `${label}.caip2`);
  equal(value.chainDeploymentId, CHAIN.chainDeploymentId, `${label}.chainDeploymentId`);
}

const direct = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  const options = parseCli(process.argv.slice(2));
  const result = options.command === "audit" ? auditV4ReleaseBinding(options)
    : requireV4ReleaseReady(options);
  process.stdout.write(`${JSON.stringify({ schemaVersion: V4_RELEASE_BINDING_SCHEMA,
    bindingSha256: result.bindingSha256, releaseReady: result.releaseReady,
    blockers: result.blockers })}\n`);
}
