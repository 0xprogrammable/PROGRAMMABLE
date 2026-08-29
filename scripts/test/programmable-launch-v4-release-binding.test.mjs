import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  V4_RELEASE_BINDING_SCHEMA,
  auditV4ReleaseBinding,
  computeV4ChainDeploymentBindingDigest,
  computeV4ChainDeploymentDescriptorDigest,
  computeV4FinalityEvidenceDigest,
  computeV4ProfileEvidenceDigest,
  computeV4ReleaseManifestDigest,
  computeV4SourceClosureDigest,
  requireV4ReleaseReady,
} from "../programmable-launch-v4-release-binding.mjs";

const repositoryRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const releaseDirectory = path.join(
  repositoryRoot,
  "docs/operations/releases/custom-launch-v4",
);
const [committedBinding, bindingSchema, packSchema] = await Promise.all([
  readJson(path.join(releaseDirectory, "cli-release-binding.json")),
  readJson(path.join(releaseDirectory, "cli-release-binding.schema.json")),
  readJson(path.join(repositoryRoot, "public/schemas/custom-launch/v4/pack-config.json")),
]);
const sourcePaths = [
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
  "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
  "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
];
const expectedBlockers = [
  "chainDeploymentEvidence",
  "profileEvidence",
  "releaseManifestEvidence",
  "sourceClosureEvidence",
  "finalityEvidence",
];
const expectedPolicySource = {
  schemaVersion: "programmable.custom-launch-policy-source.v1",
  repository: "programmablehq/Launch-Policy",
  repositoryId: 1_320_171_831,
  protectedBranch: "main",
  verifiedMergeCommit: "987215867472229690e30e11000c626d58f46e16",
  verifiedTree: "284fb19f05cdf9b5b60b8bacfbd480f6b98decd3",
  artifacts: {
    descriptor: {
      path: "policy/custom-launch-admission-v4.json",
      digest: "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948",
    },
    businessPolicy: {
      path: "policy/launch-policy.v1.json",
      digest: "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216",
    },
    generatedBinding: {
      path: ".programmable/custom-launch-admission.v4.json",
      digest: "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2",
    },
    schema: {
      path: "policy/schemas/custom-launch-admission-v4.schema.json",
      digest: "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
    },
  },
};

test("committed V4 binding pins policy bytes and remains blocked on five evidence objects", () => {
  const result = auditV4ReleaseBinding({ repositoryRoot });
  assert.equal(result.binding.schemaVersion, V4_RELEASE_BINDING_SCHEMA);
  assert.equal(result.releaseReady, false);
  assert.deepEqual(result.blockers, expectedBlockers);
  assert.deepEqual(result.binding.releaseIdentity.policySource, expectedPolicySource);
  assert.deepEqual(result.binding.evidence, {
    chainDeployment: null,
    profile: null,
    manifest: null,
    source: null,
    finality: null,
  });
  assert.throws(
    () => requireV4ReleaseReady({ repositoryRoot }),
    /blocked: chainDeploymentEvidence/u,
  );
});

test("committed V4 binding validates against its local closed JSON Schema", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validate = ajv.compile(bindingSchema);
  assert.equal(validate(committedBinding), true, JSON.stringify(validate.errors));
  const mutation = { ...structuredClone(committedBinding), undeclared: true };
  assert.equal(validate(mutation), false, "release binding schema must reject extra fields");
});

test("descriptor digest uses Ethereum Keccak-256 rather than NIST SHA3-256", () => {
  assert.equal(
    computeV4ChainDeploymentDescriptorDigest({}),
    "0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d",
  );
});

test("a digest-shaped deployment placeholder does not reduce the five release blockers", async () => {
  const fixture = await materializeFixture();
  try {
    fixture.binding.chain.chainDeploymentDescriptorDigest = `0x${"1".repeat(64)}`;
    await writeBinding(fixture.root, fixture.binding);
    const result = auditV4ReleaseBinding({ repositoryRoot: fixture.root });
    assert.equal(result.releaseReady, false);
    assert.deepEqual(result.blockers, expectedBlockers);

    fixture.binding.releaseReady = true;
    fixture.binding.blockers = [];
    await writeBinding(fixture.root, fixture.binding);
    assert.throws(
      () => auditV4ReleaseBinding({ repositoryRoot: fixture.root }),
      /blockers|releaseReady/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("five mechanically recomputed evidence objects unlock readiness", async () => {
  const fixture = await materializeFixture({ complete: true });
  try {
    const result = requireV4ReleaseReady({ repositoryRoot: fixture.root });
    assert.equal(result.releaseReady, true);
    assert.deepEqual(result.blockers, []);
    assert.match(
      result.binding.evidence.chainDeployment.descriptorDigest,
      /^0x[0-9a-f]{64}$/u,
    );
    assert.match(
      result.binding.evidence.manifest.releaseManifestDigest,
      /^sha256:[0-9a-f]{64}$/u,
    );

    const descriptor = result.binding.evidence.chainDeployment.descriptor;
    assert.deepEqual(descriptor.deploymentEvidence.sourceVerification, {
      sourcifyExactMatchCoveredContracts: ["programmableLaunchStampRouter", "graphFactory"],
      officialSourcePinnedCoveredContracts: ["permitAuthority"],
    });
    const safe = descriptor.permitAuthoritySourceProvenance.configurationEvidence;
    assert.equal(
      descriptor.permitAuthoritySourceProvenance.sourceCommitment,
      "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
    );
    assert.equal(
      safe.atomicRootStateEvidenceDigest,
      descriptor.deploymentEvidence.resultingContracts[0].stateEvidenceDigest,
    );
    assert.deepEqual(
      safe.ethereumFinalityEvidence.ethereumProviders.map(({ providerId, trustDomain }) => ({
        providerId,
        trustDomain,
      })),
      [
        { providerId: "drpc", trustDomain: "drpc.org" },
        { providerId: "quicknode", trustDomain: "quicknode.com" },
      ],
    );
    assert.equal(descriptor.permit2GenesisProvenance.startBlock, "0");
    assert.deepEqual(
      descriptor.permit2GenesisProvenance.providerReadbacks.map(({ providerId }) => providerId),
      ["drpc", "alchemy"],
    );
    assert.deepEqual(
      descriptor.externalRootDeploymentEvidence.map(({ contract }) => contract),
      ["poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter"],
    );
    assert.ok(descriptor.externalRootDeploymentEvidence.every((entry) =>
      entry.registrySource.sha256
        === "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("each full evidence gate rejects drift after its outer digest is recomputed", async () => {
  const fixture = await materializeFixture({ complete: true });
  try {
    const cases = [
      ["deployment", (binding) => {
        binding.evidence.chainDeployment.descriptor.contracts.graphFactory.runtimeCodeHash =
          `0x${"9".repeat(64)}`;
        refreshDeploymentBinding(binding);
      }, /pinned Robinhood root|descriptor/u],
      ["profile", (binding) => {
        binding.evidence.profile.fundingModes.reverse();
        binding.evidence.profile.profileEvidenceDigest = computeV4ProfileEvidenceDigest(
          binding.evidence.profile,
        );
      }, /profile funding modes/u],
      ["source", (binding) => {
        binding.evidence.source.entries[0].sha256 = `sha256:${"8".repeat(64)}`;
        binding.evidence.source.sourceClosureDigest = computeV4SourceClosureDigest(
          binding.evidence.source,
        );
      }, /source entry/u],
      ["finality", (binding) => {
        binding.evidence.finality.ethereumFinalityEvidence.ethereumProviders.reverse();
        binding.evidence.finality.finalityEvidenceDigest = computeV4FinalityEvidenceDigest(
          binding.evidence.finality,
        );
      }, /finality\/deployment Ethereum evidence/u],
      ["manifest", (binding) => {
        binding.evidence.manifest.sourceRevision = "a".repeat(40);
        binding.evidence.manifest.releaseManifestDigest = computeV4ReleaseManifestDigest(
          binding.evidence.manifest,
        );
      }, /manifest source revision/u],
    ];
    for (const [label, mutate, message] of cases) {
      const binding = structuredClone(fixture.binding);
      mutate(binding);
      await writeBinding(fixture.root, binding);
      assert.throws(
        () => auditV4ReleaseBinding({ repositoryRoot: fixture.root }),
        message,
        label,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("per-contract provenance cannot collapse into a global Sourcify claim", async () => {
  const fixture = await materializeFixture({ complete: true });
  try {
    const cases = [
      ["Safe as Sourcify", (descriptor) => {
        descriptor.deploymentEvidence.sourceVerification = {
          sourcifyExactMatchCoveredContracts: [
            "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
          ],
          officialSourcePinnedCoveredContracts: [],
        };
        recomputeEvidence(
          descriptor.deploymentEvidence,
          "programmable.robinhood-atomic-root-deployment-evidence.v1",
        );
      }],
      ["Safe source commitment", (descriptor) => {
        descriptor.permitAuthoritySourceProvenance.sourceCommitment =
          `sha256:${"a".repeat(64)}`;
      }],
      ["Permit2 non-genesis", (descriptor) => {
        descriptor.permit2GenesisProvenance.startBlock = "1";
      }],
      ["Uniswap registry source", (descriptor) => {
        descriptor.externalRootDeploymentEvidence[0].registrySource.sha256 =
          `sha256:${"b".repeat(64)}`;
      }],
    ];
    for (const [label, mutate] of cases) {
      const binding = structuredClone(fixture.binding);
      mutate(binding.evidence.chainDeployment.descriptor);
      refreshDeploymentBinding(binding);
      await writeBinding(fixture.root, binding);
      assert.throws(
        () => auditV4ReleaseBinding({ repositoryRoot: fixture.root }),
        /deploymentEvidence|source provenance|Permit2|external root|invalid/u,
        label,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V4 binding fails closed on machine bytes, policy source, policy, and extra fields", async () => {
  const fixture = await materializeFixture();
  try {
    const mutations = [
      (binding) => { binding.machineContracts[0].sha256 = `sha256:${"0".repeat(64)}`; },
      (binding) => {
        binding.releaseIdentity.policySource.verifiedMergeCommit = "0".repeat(40);
      },
      (binding) => { binding.releaseIdentity.policySource.verifiedTree = "0".repeat(40); },
      (binding) => {
        binding.releaseIdentity.policySource.artifacts.descriptor.path = "policy/other.json";
      },
      (binding) => { binding.releaseIdentity.finalityPolicy.policyRevision = 2; },
      (binding) => { binding.evidence.undeclared = null; },
    ];
    for (const mutate of mutations) {
      const binding = structuredClone(fixture.binding);
      mutate(binding);
      await writeBinding(fixture.root, binding);
      assert.throws(
        () => auditV4ReleaseBinding({ repositoryRoot: fixture.root }),
        /do(?:es)? not match|invalid|fields/u,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function materializeFixture({ complete = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-binding-"));
  await mkdir(path.join(root, "public", "openapi"), { recursive: true });
  await mkdir(path.join(root, "public", "schemas", "custom-launch", "v4"), {
    recursive: true,
  });
  await mkdir(path.join(root, "docs", "operations", "releases", "custom-launch-v4"), {
    recursive: true,
  });
  const binding = structuredClone(committedBinding);
  for (const { path: relative } of binding.machineContracts) {
    await cp(path.join(repositoryRoot, relative), path.join(root, relative));
  }
  if (complete) await addCompleteEvidence(root, binding);
  await writeBinding(root, binding);
  return { root, binding };
}

async function addCompleteEvidence(root, binding) {
  for (const [index, relative] of sourcePaths.entries()) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `fixture source ${index}\n`, "utf8");
  }
  runGit(root, ["init", "-b", "production"]);
  runGit(root, ["add", "-A"]);
  runGit(root, [
    "-c", "user.name=Programmable Release Test",
    "-c", "user.email=release-test@programmable.invalid",
    "commit", "-m", "materialize release evidence fixture",
  ]);
  const revision = runGit(root, ["rev-parse", "HEAD"]);
  const tree = runGit(root, ["rev-parse", "HEAD^{tree}"]);
  const descriptor = buildCompleteChainDeployment(binding.releaseIdentity);
  const deployment = {
    schemaVersion: "programmable.launch-cli-v4-chain-deployment-binding.v1",
    descriptor,
    descriptorDigest: computeV4ChainDeploymentDescriptorDigest(descriptor),
    bindingDigest: null,
  };
  deployment.bindingDigest = computeV4ChainDeploymentBindingDigest(deployment);

  const profile = {
    schemaVersion: "programmable.launch-cli-v4-profile-evidence.v1",
    profile: structuredClone(binding.releaseIdentity.profile),
    chainDeploymentDescriptorDigest: deployment.descriptorDigest,
    fundingModes: ["none", "wallet-transaction-value"],
    capabilities: {
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      genericClaimingLive: false,
      buybacksLive: false,
    },
    profileEvidenceDigest: null,
  };
  profile.profileEvidenceDigest = computeV4ProfileEvidenceDigest(profile);

  const entries = [];
  for (const relative of sourcePaths) {
    const bytes = await readFile(path.join(root, relative));
    entries.push({ path: relative, byteLength: String(bytes.byteLength), sha256: digest(bytes) });
  }
  const source = {
    schemaVersion: "programmable.launch-cli-v4-source-closure.v1",
    repository: "programmablehq/PROGRAMMABLE",
    branch: "production",
    revision,
    tree,
    foundationSourceCommitment: descriptor.foundationSourceCommitment,
    entries,
    sourceClosureDigest: null,
  };
  source.sourceClosureDigest = computeV4SourceClosureDigest(source);

  const atomic = descriptor.deploymentEvidence;
  const finality = {
    schemaVersion: "programmable.launch-cli-v4-finality-evidence.v1",
    chainDeploymentDescriptorDigest: deployment.descriptorDigest,
    deploymentTransactionHash: atomic.transactionHash,
    l2Checkpoint: structuredClone(atomic.ethereumFinalityEvidence.l2Checkpoint),
    ethereumFinalityEvidence: structuredClone(atomic.ethereumFinalityEvidence),
    finalityEvidenceDigest: null,
  };
  finality.finalityEvidenceDigest = computeV4FinalityEvidenceDigest(finality);

  const manifest = {
    schemaVersion: "programmable.launch-cli-v4-release-manifest.v1",
    releaseIdentity: structuredClone(binding.releaseIdentity),
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    chainDeploymentDescriptorDigest: deployment.descriptorDigest,
    chainDeploymentBindingDigest: deployment.bindingDigest,
    profileEvidenceDigest: profile.profileEvidenceDigest,
    sourceRevision: source.revision,
    sourceTree: source.tree,
    sourceClosureDigest: source.sourceClosureDigest,
    deploymentTransactionHash: atomic.transactionHash,
    deploymentBlockHash: atomic.blockHash,
    finalityEvidenceDigest: finality.finalityEvidenceDigest,
    machineContracts: binding.machineContracts.map(({ name, sha256 }) => ({ name, sha256 })),
    releaseManifestDigest: null,
  };
  manifest.releaseManifestDigest = computeV4ReleaseManifestDigest(manifest);

  binding.chain.chainDeploymentDescriptorDigest = deployment.descriptorDigest;
  binding.evidence = { chainDeployment: deployment, profile, manifest, source, finality };
  binding.blockers = [];
  binding.releaseReady = true;
}

function buildCompleteChainDeployment(releaseIdentity) {
  const descriptor = fixtureFromSchema(packSchema.$defs.chainDeployment);
  descriptor.finality = structuredClone(releaseIdentity.finalityPolicy);
  const atomic = descriptor.deploymentEvidence;
  const safe = descriptor.permitAuthoritySourceProvenance.configurationEvidence;
  const blockNumber = "49230000";
  const blockHash = codeHash("2");
  atomic.transactionHash = codeHash("1");
  atomic.blockNumber = blockNumber;
  atomic.blockHash = blockHash;
  descriptor.permitAuthoritySourceProvenance.transactionHash = atomic.transactionHash;
  descriptor.permitAuthoritySourceProvenance.blockNumber = blockNumber;
  descriptor.permitAuthoritySourceProvenance.blockHash = blockHash;
  safe.blockNumber = blockNumber;
  safe.blockHash = blockHash;
  safe.ethereumFinalityEvidence.l2Checkpoint = { blockNumber, blockHash };
  recomputeEvidence(safe.ethereumFinalityEvidence);
  atomic.ethereumFinalityEvidence = structuredClone(safe.ethereumFinalityEvidence);

  atomic.receiptLogs = [];
  atomic.receiptLogsDigest = framedDigest(
    "programmable.robinhood-atomic-root-deployment-receipt-logs.v1",
    atomic.receiptLogs,
  );
  for (const readback of atomic.providerReadbacks) {
    readback.transactionHash = atomic.transactionHash;
    recomputeEvidence(
      readback,
      "programmable.robinhood-atomic-root-deployment-provider-readback.v1",
    );
  }
  for (const result of atomic.resultingContracts) {
    const predecessorBlockHash = codeHash("3");
    for (const readback of result.providerReadbacks) {
      readback.preDeploymentBlockNumber = (BigInt(blockNumber) - 1n).toString(10);
      readback.preDeploymentBlockHash = predecessorBlockHash;
      readback.preDeploymentRuntimeCodeHash = result.previousBlockRuntimeCodeHash;
      readback.deploymentBlockNumber = blockNumber;
      readback.deploymentBlockHash = blockHash;
      readback.contract = result.contract;
      readback.address = result.address;
      readback.deploymentRuntimeCodeHash = result.runtimeCodeHash;
      recomputeEvidence(
        readback,
        "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1",
      );
    }
    result.stateEvidenceDigest = framedDigest(
      "programmable.robinhood-atomic-root-deployment-result-state.v1",
      omit(result, "stateEvidenceDigest"),
    );
  }
  safe.atomicRootStateEvidenceDigest = atomic.resultingContracts[0].stateEvidenceDigest;
  recomputeEvidence(safe);
  recomputeEvidence(descriptor.permitAuthoritySourceProvenance);
  recomputeEvidence(atomic, "programmable.robinhood-atomic-root-deployment-evidence.v1");

  const permit2 = descriptor.permit2GenesisProvenance;
  permit2.providerReadbacks[1].blockHash = permit2.providerReadbacks[0].blockHash;
  permit2.providerReadbacks.forEach((readback) => recomputeEvidence(readback));
  recomputeEvidence(permit2);

  for (const external of descriptor.externalRootDeploymentEvidence) {
    for (const readback of external.providerReadbacks) {
      readback.blockHash = external.blockHash;
      recomputeEvidence(
        readback,
        "programmable.custom-launch-deployment-provider-readback.v1",
      );
    }
    recomputeEvidence(external);
  }

  descriptor.contracts = Object.fromEntries([
    ...atomic.resultingContracts.map((result) => [result.contract, {
      address: result.address,
      runtimeCodeHash: result.runtimeCodeHash,
    }]),
    ...descriptor.externalRootDeploymentEvidence.map((entry) => [entry.contract, {
      address: entry.address,
      runtimeCodeHash: entry.runtimeCodeHash,
    }]),
    ["permit2", {
      address: permit2.address,
      runtimeCodeHash: permit2.providerReadbacks[0].runtimeCodeHash,
    }],
  ]);
  return descriptor;
}

function recomputeEvidence(value, domain = value.schemaVersion) {
  value.evidenceDigest = framedDigest(domain, omit(value, "evidenceDigest"));
}

function refreshDeploymentBinding(binding) {
  const deployment = binding.evidence.chainDeployment;
  deployment.descriptorDigest = computeV4ChainDeploymentDescriptorDigest(deployment.descriptor);
  deployment.bindingDigest = computeV4ChainDeploymentBindingDigest(deployment);
  binding.chain.chainDeploymentDescriptorDigest = deployment.descriptorDigest;
}

function fixtureFromSchema(schema, index = 0) {
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (Array.isArray(schema.enum)) return structuredClone(schema.enum[0]);
  if (Array.isArray(schema.oneOf)) return fixtureFromSchema(schema.oneOf[0], index);
  if (schema.type === "object" || schema.properties !== undefined) {
    return Object.fromEntries((schema.required ?? []).map((name, propertyIndex) => [
      name,
      fixtureFromSchema(schema.properties[name], index + propertyIndex),
    ]));
  }
  if (schema.type === "array") {
    if (Array.isArray(schema.prefixItems)) {
      return schema.prefixItems.map((item, itemIndex) =>
        fixtureFromSchema(item, index + itemIndex));
    }
    return Array.from({ length: schema.minItems ?? 0 }, (_, itemIndex) =>
      fixtureFromSchema(schema.items, index + itemIndex));
  }
  if (schema.type === "integer" || schema.type === "number") return schema.minimum ?? 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "null") return null;
  return fixtureString(schema, index);
}

function fixtureString(schema, index) {
  if (schema.format === "date-time") return "2026-08-29T18:00:00.000Z";
  const pattern = schema.pattern ?? "";
  if (pattern.includes("sha256:")) return `sha256:${"1".repeat(64)}`;
  if (pattern.includes("{40}")) return `0x${"1".repeat(40)}`;
  if (pattern.includes("{64}")) return `0x${"1".repeat(64)}`;
  if (pattern.startsWith("^0x") && pattern.includes("{2}")) return "0x";
  if (pattern.includes("[1-9][0-9]") || pattern.includes("0|[1-9]")) return "1";
  return `fixture-${index}`;
}

const codeHash = (digit) => `0x${digit.repeat(64)}`;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const framedDigest = (domain, value) => digest(Buffer.concat([
  Buffer.from(domain, "utf8"),
  Buffer.from([0]),
  Buffer.from(canonical(value), "utf8"),
]));

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function omit(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function writeBinding(root, binding) {
  await writeFile(
    path.join(root, "docs/operations/releases/custom-launch-v4/cli-release-binding.json"),
    `${JSON.stringify(binding, null, 2)}\n`,
    "utf8",
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
