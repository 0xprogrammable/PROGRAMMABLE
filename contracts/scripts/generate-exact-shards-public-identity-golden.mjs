import { createHash } from "node:crypto";

import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/u;
const DOMAIN = /^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/u;

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("unpaired high surrogate");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("unpaired low surrogate");
    }
  }
}

function canonicalJson(value, ancestors = new WeakSet()) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`non-JSON value: ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("cyclic JSON value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).some((key) => (
        typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))
      ))) {
        throw new TypeError("non-canonical array property");
      }
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("sparse JSON array");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
          || !("value" in descriptor)
          || descriptor.enumerable !== true
        ) throw new TypeError("canonical JSON requires enumerable array data properties");
        entries.push(canonicalJson(descriptor.value, ancestors));
      }
      return `[${entries.join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("canonical JSON requires a plain object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new TypeError("symbol JSON key");
    return `{${keys.sort().map((key) => {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !("value" in descriptor)
        || descriptor.enumerable !== true
      ) throw new TypeError("canonical JSON requires enumerable data properties");
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
    }).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalSha256(domain, value) {
  if (!DOMAIN.test(domain)) throw new TypeError("invalid Programmable hash domain");
  const canonicalJsonUtf8 = canonicalJson(value);
  const digest = createHash("sha256")
    .update(domain, "utf8")
    .update(Uint8Array.of(0))
    .update(canonicalJsonUtf8, "utf8")
    .digest("hex");
  return { canonicalJsonUtf8, digest: `sha256:${digest}`, rawBytes32: `0x${digest}` };
}

function rawSha256Digest(value) {
  const match = SHA256_DIGEST.exec(value);
  if (match === null) throw new TypeError("invalid canonical SHA-256 digest");
  return `0x${match[1]}`;
}

const projectDomain = "programmable.custom-launch-project-id.v2";
const launchDomain = "programmable.custom-launch-id.v2";
const publicIdentityTypeString = "ExactShardsPublicIdentityBindingV1(bytes32 websiteProjectIdSha256,bytes32 websiteLaunchIdSha256,bytes32 registryProjectId,bytes32 registryApprovalId,bytes32 registryLaunchId,uint64 githubRepositoryId,uint64 approvalGeneration,uint256 chainId,address registry,uint64 registryGeneration,bytes32 routeId,address primaryContract)";
const publicIdentityTypehash = keccak256(stringToHex(publicIdentityTypeString));

const projectInput = {
  launchFamily: "custom",
  grantId: "11111111-1111-4111-8111-111111111111",
  grantBindingHash: "sha256:f34c6d9d683f81ac44f9966fcbd2529c036f94f261cbdd60245677f4e2e87ec8",
};
const project = canonicalSha256(projectDomain, projectInput);

const launchInput = {
  launchFamily: "custom",
  projectId: project.digest,
  chainId: "1",
  launchIdentity: {
    namespace: "eip155:1:contract",
    value: "0xcccccccccccccccccccccccccccccccccccccccc",
  },
};
const launch = canonicalSha256(launchDomain, launchInput);

const repositoryDomain = "programmable.github.repository.v1";
const projectIdDomain = keccak256(stringToHex("programmable.project-id.v1"));
const approvalIdDomain = keccak256(stringToHex("programmable.target-approval-id.v1"));
const launchIdDomain = keccak256(stringToHex("programmable.target-launch-id.v1"));
const githubRepositoryId = 1_329_073_878n;
const approvalGeneration = 4n;
const chainId = 1n;
const registry = getAddress("0x3000000000000000000000000000000000000003");
const registryGeneration = 3n;
const routeId = keccak256(stringToHex("programmable.exact-shards.atomic-launch-route.v1"));
// Fixed sample reused from contracts/spec/launch-permit-v1-golden.json. It represents the
// Approval-produced technical binding consumed as registration.approvalBindingHash.
const technicalApprovalHash = "0x51117b520b79582e79c9152c7a7a9bf675fa64f5441c4d62e63a96e5fc768bc5";
const repositoryKey = keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "uint256" }],
  [repositoryDomain, githubRepositoryId],
));
const registryProjectId = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }],
  [projectIdDomain, repositoryKey],
));
const registryApprovalId = keccak256(encodeAbiParameters(
  [
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "uint64" },
    { type: "bytes32" },
    { type: "uint256" },
    { type: "address" },
    { type: "uint64" },
    { type: "bytes32" },
  ],
  [
    approvalIdDomain,
    registryProjectId,
    approvalGeneration,
    technicalApprovalHash,
    chainId,
    registry,
    registryGeneration,
    routeId,
  ],
));
const registryLaunchId = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
  [launchIdDomain, registryProjectId, registryApprovalId],
));

const registryInput = {
  websiteProjectIdSha256: rawSha256Digest(project.digest),
  websiteLaunchIdSha256: rawSha256Digest(launch.digest),
  registryProjectId,
  registryApprovalId,
  registryLaunchId,
  githubRepositoryId,
  approvalGeneration,
  chainId,
  registry,
  registryGeneration,
  routeId,
  primaryContract: getAddress("0x5000000000000000000000000000000000000005"),
};

const mappingComponents = [
  { name: "websiteProjectIdSha256", type: "bytes32" },
  { name: "websiteLaunchIdSha256", type: "bytes32" },
  { name: "registryProjectId", type: "bytes32" },
  { name: "registryApprovalId", type: "bytes32" },
  { name: "registryLaunchId", type: "bytes32" },
  { name: "githubRepositoryId", type: "uint64" },
  { name: "approvalGeneration", type: "uint64" },
  { name: "chainId", type: "uint256" },
  { name: "registry", type: "address" },
  { name: "registryGeneration", type: "uint64" },
  { name: "routeId", type: "bytes32" },
  { name: "primaryContract", type: "address" },
];

function identityMappingHash(input) {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, ...mappingComponents],
    [publicIdentityTypehash, ...mappingComponents.map(({ name }) => input[name])],
  ));
}

const identityMappingHashV1 = identityMappingHash(registryInput);
const mutatedWebsiteLaunchIdSha256 = `0x${(BigInt(registryInput.websiteLaunchIdSha256) ^ 1n).toString(16).padStart(64, "0")}`;
const mutatedIdentityMappingHash = identityMappingHash({
  ...registryInput,
  websiteLaunchIdSha256: mutatedWebsiteLaunchIdSha256,
});
if (mutatedIdentityMappingHash === identityMappingHashV1) throw new Error("one-bit mutation was not bound");

const stringify = (_, value) => typeof value === "bigint" ? value.toString() : value;
process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.exact-shards-public-identity-golden.v1",
  hashNamespaces: {
    websiteIds: "sha256(domain || 0x00 || RFC-8785-compatible-canonical-json-utf8)",
    onchainIdentityMapping: "keccak256(abi.encode(typehash, twelve typed fields))",
  },
  approvalFormula: {
    sourceFormulaObservedAtCommit: "e59bce4fabe43369ebc5a0ef9718fdd73b747c81",
    sourceFormulaObservedAtTree: "fec89669b681b1f26789583e65c754a88797d6b7",
    finalSourceRevisionRegenerationRequired: false,
    sourceModule: "services/autonomous-approval-v1/src/adapters/custom-launch-public-identity-v2.ts",
    sourceModuleGitBlobSha1: "f6ebcd5de53115c573e5ebc3137d621d5b49987f",
    canonicalHashModule: "services/autonomous-approval-v1/src/domain/hashing.ts",
    canonicalHashModuleGitBlobSha1: "292e01e357a6f27500cf51eba17cf873026de213",
    canonicalJsonModuleGitBlobSha1: "464f15cb080b36ddf3e1ed8687e55d53e404973d",
    identityValidatorModule: "services/autonomous-approval-v1/src/rpc/finalized-launch-verifier.ts",
    identityValidatorModuleGitBlobSha1: "700fb4e4596351db964e07df659d7da186b9ca38",
    projectionFixtureModule: "services/autonomous-approval-v1/test/adapters/custom-launch-public-identity-v2.test.ts",
    projectionFixtureModuleGitBlobSha1: "6b1a5fd84d68d914a2801185ea32c1cdbc4fdd24",
    projectDomain,
    projectFields: ["launchFamily", "grantId", "grantBindingHash"],
    launchDomain,
    launchFields: ["launchFamily", "projectId", "chainId", "launchIdentity"],
  },
  project: { input: projectInput, ...project },
  launch: { input: launchInput, ...launch },
  exactShardsFormula: {
    repositoryDomain,
    projectIdDomain,
    approvalIdDomain,
    launchIdDomain,
    repositoryKeyFormula: "keccak256(abi.encode(string repositoryDomain,uint256 githubRepositoryId))",
    projectIdFormula: "keccak256(abi.encode(bytes32 projectIdDomain,bytes32 repositoryKey))",
    approvalIdFormula: "keccak256(abi.encode(bytes32 approvalIdDomain,bytes32 projectId,uint64 approvalGeneration,bytes32 approvalBindingHash,uint256 chainId,address registry,uint64 registryGeneration,bytes32 routeId))",
    launchIdFormula: "keccak256(abi.encode(bytes32 launchIdDomain,bytes32 projectId,bytes32 approvalId))",
    inputs: {
      githubRepositoryId,
      approvalGeneration,
      technicalApprovalHashFixtureSource: "contracts/spec/launch-permit-v1-golden.json",
      technicalApprovalHash,
      registryApprovalBindingHash: technicalApprovalHash,
      chainId,
      registry,
      registryGeneration,
      routeId,
    },
    repositoryKey,
    projectId: registryProjectId,
    approvalId: registryApprovalId,
    launchId: registryLaunchId,
  },
  registryBinding: {
    typeString: publicIdentityTypeString,
    typehash: publicIdentityTypehash,
    input: registryInput,
    identityMappingHash: identityMappingHashV1,
  },
  oneBitMutation: {
    field: "websiteLaunchIdSha256",
    operation: "xor-lowest-bit",
    mutatedValue: mutatedWebsiteLaunchIdSha256,
    mutatedIdentityMappingHash,
    exactMappingAccepted: false,
  },
}, stringify, 2)}\n`);
