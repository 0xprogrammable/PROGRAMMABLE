import { keccak256 } from "viem";

import {
  CLASSIC_V4_CHAIN_ID,
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_FEE_RECIPIENT,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
  CLASSIC_V4_NEW_CONTRACTS,
  CLASSIC_V4_OFFICIAL_DEPENDENCIES,
  CLASSIC_V4_RELEASE,
  CLASSIC_V4_SHARED_DEPENDENCIES,
  CLASSIC_V4_SOURCE_TARGETS,
  artifactRuntimeDescriptor,
  assertBytes32,
  canonicalNonzeroAddress,
  createClassicV4ReleaseManifest,
  digestJson,
  normalizeHex,
  validateClassicV4DeploymentEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "./classic-v4-release-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
  classicV4LauncherUpgradeConstructorArguments,
  computeClassicV4LauncherUpgradeBuildCommitments,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "./classic-v4-launcher-upgrade-core.mjs";

const OLD_CONTRACTS = Object.freeze([
  "hookFactory",
  "feeHook",
  "positionPlanner",
]);
const SOURCE_RECORD_KEYS = Object.freeze([
  "address",
  "contractName",
  "fqcn",
  "encodedConstructorArguments",
  "deploymentTransaction",
  "deploymentBlock",
  "status",
  "providers",
]);

export const CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS = Object.freeze({
  artifactSourceClosure:
    "programmable.classic-v4.launcher-rollforward-artifact-source-closure.v1",
  launcherSourceRecord:
    "programmable.classic-v4.launcher-rollforward-source-record.v1",
  sourceCommitment:
    "programmable.classic-v4.launcher-rollforward-source-commitment.v1",
  preparationPlan:
    "programmable.classic-v4.launcher-rollforward-preparation-plan.v1",
});

export const CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS = Object.freeze({
  hookFactory: CLASSIC_V4_SOURCE_TARGETS.hookFactory,
  feeHook: CLASSIC_V4_SOURCE_TARGETS.feeHook,
  positionPlanner: CLASSIC_V4_SOURCE_TARGETS.positionPlanner,
  launcher: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    `${label} keys differ`,
  );
}

function sameHex(left, right) {
  return normalizeHex(left) === normalizeHex(right);
}

function sameJson(left, right) {
  return digestJson(left) === digestJson(right);
}

function nonzeroHash(value, label) {
  const hash = assertBytes32(value, label);
  assert(BigInt(hash) !== 0n, `Invalid ${label}`);
  return hash;
}

function commit(value, label) {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{40}$/i.test(value) &&
      value !== "0".repeat(40),
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

function isoTime(value, label) {
  const timestamp = Date.parse(value);
  assert(
    typeof value === "string" &&
      !Number.isNaN(timestamp) &&
      new Date(timestamp).toISOString() === value,
    `Invalid ${label}`,
  );
  return timestamp;
}

function bytecode(value, label, { empty = true } = {}) {
  assert(
    typeof value === "string" &&
      /^0x(?:[0-9a-f]{2})*$/i.test(value) &&
      (empty || value !== "0x"),
    `Invalid ${label}`,
  );
  return value;
}

function unsigned(value, digestKey) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestKey),
  );
}

function artifactSourceClosure(artifact, label) {
  let metadata;
  try {
    metadata =
      typeof artifact?.metadata === "string"
        ? JSON.parse(artifact.metadata)
        : artifact?.metadata;
  } catch {
    throw new Error(`${label} artifact metadata is invalid`);
  }
  const sources = Object.entries(metadata?.sources ?? {})
    .map(([sourcePath, source]) => {
      assert(
        /^(?:src|lib\/[a-z0-9-]+)\/[A-Za-z0-9_./-]+\.sol$/.test(
          sourcePath,
        ) && !sourcePath.split("/").includes(".."),
        `${label} artifact source path is invalid`,
      );
      return {
        sourcePath,
        sourceHash: nonzeroHash(source?.keccak256, `${label} source hash`),
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  assert(sources.length > 0, `${label} artifact source closure is empty`);
  return digestJson(
    sources,
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.artifactSourceClosure,
  );
}

function sourceMaterial(plan) {
  return {
    lineage: plan.lineage,
    predictedAddresses: plan.predictedAddresses,
    runtimeTemplates: plan.runtimeTemplates,
    artifactSourceClosures: plan.artifactSourceClosures,
    constructorArguments: plan.constructorArguments,
    launcherDependencies: plan.launcherDependencies,
    sourceTargets: plan.sourceTargets,
  };
}

function expectedUpgradeDependencies(basePlan, baseDeployment) {
  return {
    poolManager: basePlan.officialDependencies.poolManager,
    positionManager: basePlan.officialDependencies.positionManager,
    tokenFactory: basePlan.officialDependencies.uerc20Factory,
    feeHook: {
      address: basePlan.predictedAddresses.feeHook,
      runtimeCodeHash: baseDeployment.contracts.feeHook.runtimeCodeHash,
    },
    positionPlanner: {
      address: basePlan.predictedAddresses.positionPlanner,
      runtimeCodeHash: baseDeployment.contracts.positionPlanner.runtimeCodeHash,
    },
    rewardVaultFactory: basePlan.sharedDependencies.rewardVaultFactory,
    initialBuyVestingWalletFactory:
      basePlan.sharedDependencies.initialBuyVestingWalletFactory,
    launchPolicy: basePlan.sharedDependencies.launchPolicy,
    positionForwarderFactory:
      basePlan.sharedDependencies.positionForwarderFactory,
  };
}

export function validateClassicV4LauncherUpgradeVerificationEvidence(
  plan,
  receipt,
  evidence,
) {
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, receipt);
  exactKeys(
    evidence,
    [
      "schemaVersion", "status", "chainId", "planDigest",
      "receiptEvidenceDigest", "sourceCommitment", "verificationBlock",
      "verificationBlockHash", "checkedAt", "independentRpcCount",
      "confirmations", "transactionHash", "contractAddress",
      "runtimeCodeHash", "runtimeTemplateHash", "dependencyRuntimeVerified",
      "dependencyBindingsVerified", "constructorBindingsVerified",
      "canonicalRouterVerified", "evidenceDigest",
    ],
    "launcher verification evidence",
  );
  assert(
    evidence.schemaVersion === 1 &&
      evidence.status === "finalized" &&
      evidence.chainId === CLASSIC_V4_CHAIN_ID &&
      sameHex(evidence.planDigest, plan.planDigest) &&
      sameHex(evidence.receiptEvidenceDigest, receipt.evidenceDigest) &&
      sameHex(evidence.sourceCommitment, plan.sourceCommitment) &&
      sameHex(evidence.transactionHash, receipt.transactionHash) &&
      sameHex(evidence.contractAddress, plan.predictedAddress) &&
      sameHex(
        evidence.runtimeTemplateHash,
        plan.runtimeTemplate.runtimeTemplateHash,
      ),
    "Launcher verification identity differs",
  );
  nonzeroHash(evidence.verificationBlockHash, "verification block hash");
  nonzeroHash(evidence.transactionHash, "launcher transaction hash");
  nonzeroHash(evidence.runtimeCodeHash, "launcher runtime code hash");
  isoTime(evidence.checkedAt, "launcher verification checkedAt");
  assert(
    Number.isSafeInteger(evidence.verificationBlock) &&
      evidence.verificationBlock > 0 &&
      evidence.independentRpcCount === 2 &&
      evidence.confirmations === evidence.verificationBlock - receipt.blockNumber + 1 &&
      evidence.confirmations >= 12 &&
      evidence.dependencyRuntimeVerified === true &&
      evidence.dependencyBindingsVerified === true &&
      evidence.constructorBindingsVerified === true &&
      evidence.canonicalRouterVerified === true,
    "Launcher verification is incomplete",
  );
  nonzeroHash(evidence.evidenceDigest, "launcher verification digest");
  assert(
    sameHex(
      evidence.evidenceDigest,
      digestJson(
        unsigned(evidence, "evidenceDigest"),
        CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.verificationEvidence,
      ),
    ),
    "Launcher verification digest differs",
  );
  return evidence;
}

export function validateClassicV4LauncherRollforwardPlan(plan) {
  exactKeys(
    plan,
    [
      "schemaVersion", "status", "model", "internalContractRelease",
      "chainId", "releaseCommit", "releaseTree", "sourceCommitment",
      "deployer", "predictedAddresses", "launcherFeeRecipient",
      "officialDependencies", "sharedDependencies", "runtimeTemplates",
      "artifactSourceClosures", "constructorArguments", "transactions",
      "router", "launcherDependencies", "sourceTargets", "lineage",
      "planDigest",
    ],
    "launcher rollforward plan",
  );
  assert(
    plan.schemaVersion === 1 &&
      plan.status === "launcher-rollforward-composite" &&
      plan.model === "classic" &&
      plan.internalContractRelease === CLASSIC_V4_RELEASE &&
      plan.chainId === CLASSIC_V4_CHAIN_ID,
    "Launcher rollforward identity differs",
  );
  commit(plan.releaseCommit, "rollforward release commit");
  commit(plan.releaseTree, "rollforward release tree");
  nonzeroHash(plan.sourceCommitment, "rollforward source commitment");
  nonzeroHash(plan.planDigest, "rollforward plan digest");
  assert(
    sameJson(plan.officialDependencies, CLASSIC_V4_OFFICIAL_DEPENDENCIES) &&
      sameJson(plan.sharedDependencies, CLASSIC_V4_SHARED_DEPENDENCIES) &&
      sameHex(plan.launcherFeeRecipient, CLASSIC_V4_LAUNCHER_FEE_RECIPIENT) &&
      sameJson(plan.launcherDependencies, CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES) &&
      sameJson(plan.router, {
        address: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
        runtimeCodeHash: CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
      }) &&
      sameJson(plan.sourceTargets, CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS),
    "Launcher rollforward dependencies or source targets differ",
  );
  assert(
    sameHex(
      plan.constructorArguments.launcher,
      classicV4LauncherUpgradeConstructorArguments(),
    ),
    "V4 launcher constructor arguments differ",
  );
  for (const key of [
    "predictedAddresses",
    "runtimeTemplates",
    "artifactSourceClosures",
    "constructorArguments",
    "sourceTargets",
  ]) {
    exactKeys(plan[key], CLASSIC_V4_NEW_CONTRACTS, `rollforward ${key}`);
  }
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    canonicalNonzeroAddress(
      plan.predictedAddresses[name],
      `${name} predicted address`,
    );
    nonzeroHash(
      plan.runtimeTemplates[name]?.runtimeTemplateHash,
      `${name} runtime template hash`,
    );
    nonzeroHash(
      plan.artifactSourceClosures[name],
      `${name} artifact source closure`,
    );
    bytecode(plan.constructorArguments[name], `${name} constructor arguments`);
  }
  assert(
    sameHex(
      plan.predictedAddresses.feeHook,
      plan.launcherDependencies.feeHook.address,
    ) &&
      sameHex(
        plan.predictedAddresses.positionPlanner,
        plan.launcherDependencies.positionPlanner.address,
      ),
    "Retained launcher dependencies differ from composite addresses",
  );

  assert(
    Array.isArray(plan.transactions) && plan.transactions.length === 4,
    "Launcher rollforward requires four transactions",
  );
  const nonces = new Set();
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const transaction = plan.transactions[index];
    exactKeys(
      transaction,
      [
        "name", "transactionType", "from", "to", "nonce", "value",
        "predictedAddress", "data", "dataHash",
      ],
      `${name} rollforward transaction`,
    );
    assert(
      transaction.name === name &&
        transaction.transactionType ===
          (name === "feeHook" ? "CALL_CREATE2" : "CREATE") &&
        sameHex(transaction.from, plan.deployer) &&
        (name === "feeHook"
          ? sameHex(transaction.to, plan.predictedAddresses.hookFactory)
          : transaction.to === null) &&
        Number.isSafeInteger(transaction.nonce) && transaction.nonce >= 0 &&
        transaction.value === "0" &&
        sameHex(transaction.predictedAddress, plan.predictedAddresses[name]) &&
        sameHex(
          transaction.dataHash,
          keccak256(bytecode(transaction.data, `${name} transaction data`, { empty: false })),
        ) &&
        !nonces.has(transaction.nonce),
      `${name} rollforward transaction differs`,
    );
    nonces.add(transaction.nonce);
  }
  assert(
    plan.transactions[3].nonce >
      Math.max(...plan.transactions.slice(0, 3).map(({ nonce }) => nonce)),
    "Launcher rollforward nonce does not follow retained deployments",
  );

  exactKeys(plan.lineage, ["baseRelease", "launcherUpgrade"], "rollforward lineage");
  exactKeys(
    plan.lineage.baseRelease,
    [
      "releaseCommit", "releaseTree", "sourceCommitment", "planDigest",
      "deploymentEvidenceDigest", "sourceEvidenceDigest",
    ],
    "base release lineage",
  );
  exactKeys(
    plan.lineage.launcherUpgrade,
    [
      "releaseCommit", "releaseTree", "sourceCommitment", "planDigest",
      "receiptEvidenceDigest", "verificationEvidenceDigest",
      "launcherSourceRecordDigest", "sourceClosureDigest", "sourcePinsDigest",
    ],
    "launcher upgrade lineage",
  );
  for (const [label, lineage] of Object.entries(plan.lineage)) {
    commit(lineage.releaseCommit, `${label} commit`);
    commit(lineage.releaseTree, `${label} tree`);
    for (const [key, value] of Object.entries(lineage)) {
      if (key !== "releaseCommit" && key !== "releaseTree") {
        nonzeroHash(value, `${label} ${key}`);
      }
    }
  }
  assert(
    plan.releaseCommit === plan.lineage.launcherUpgrade.releaseCommit &&
      plan.releaseTree === plan.lineage.launcherUpgrade.releaseTree &&
      sameHex(
        plan.sourceCommitment,
        digestJson(
          sourceMaterial(plan),
          CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.sourceCommitment,
        ),
      ) &&
      sameHex(
        plan.planDigest,
        digestJson(
          unsigned(plan, "planDigest"),
          CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.preparationPlan,
        ),
      ),
    "Launcher rollforward lineage or digest differs",
  );
  return plan;
}

export function validateClassicV4LauncherRollforwardArtifacts(plan, artifacts) {
  validateClassicV4LauncherRollforwardPlan(plan);
  exactKeys(artifacts, CLASSIC_V4_NEW_CONTRACTS, "rollforward artifacts");
  for (const name of CLASSIC_V4_NEW_CONTRACTS) {
    assert(
      sameJson(
        plan.runtimeTemplates[name],
        artifactRuntimeDescriptor(artifacts[name], name),
      ) &&
        sameHex(
          plan.artifactSourceClosures[name],
          artifactSourceClosure(artifacts[name], name),
        ),
      `${name} artifact differs from the rollforward plan`,
    );
  }
  const launcherBuild = computeClassicV4LauncherUpgradeBuildCommitments(
    artifacts.launcher,
  );
  const upgradeSourceCommitment = digestJson(
    {
      contract: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
      artifact: launcherBuild.artifact,
      sourceClosureDigest: launcherBuild.sourceClosureDigest,
      sourcePinsDigest: plan.lineage.launcherUpgrade.sourcePinsDigest,
      dependencies: plan.launcherDependencies,
      router: plan.router,
      constructorArguments: plan.constructorArguments.launcher,
    },
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.sourceCommitment,
  );
  const creationCode = bytecode(
    artifacts.launcher?.bytecode?.object,
    "launcher creation bytecode",
    { empty: false },
  );
  assert(
    sameHex(
      launcherBuild.sourceClosureDigest,
      plan.lineage.launcherUpgrade.sourceClosureDigest,
    ) &&
      sameHex(
        upgradeSourceCommitment,
        plan.lineage.launcherUpgrade.sourceCommitment,
      ) &&
      sameHex(
        plan.transactions[3].data,
        creationCode + plan.constructorArguments.launcher.slice(2),
      ),
    "V4 launcher artifact, source closure or constructor differs",
  );
  return artifacts;
}

export function validateClassicV4LauncherRollforwardDeploymentEvidence(
  plan,
  evidence,
) {
  validateClassicV4LauncherRollforwardPlan(plan);
  const deployment = validateClassicV4DeploymentEvidence(plan, evidence);
  assert(
    evidence.contracts.launcher.blockNumber >
      Math.max(...OLD_CONTRACTS.map((name) => evidence.contracts[name].blockNumber)) &&
      sameHex(
        evidence.contracts.feeHook.runtimeCodeHash,
        plan.launcherDependencies.feeHook.runtimeCodeHash,
      ) &&
      sameHex(
        evidence.contracts.positionPlanner.runtimeCodeHash,
        plan.launcherDependencies.positionPlanner.runtimeCodeHash,
      ),
    "Composite deployment does not bind retained launcher dependencies",
  );
  return deployment;
}

export function validateClassicV4LauncherRollforwardSourceEvidence(
  plan,
  deployment,
  evidence,
) {
  validateClassicV4LauncherRollforwardDeploymentEvidence(plan, deployment);
  exactKeys(
    evidence,
    [
      "schemaVersion", "chainId", "planDigest", "sourceCommitment",
      "status", "checkedAt", "contracts", "evidenceDigest",
    ],
    "rollforward source evidence",
  );
  assert(
    evidence.schemaVersion === 1 &&
      evidence.chainId === CLASSIC_V4_CHAIN_ID &&
      evidence.status === "verified" &&
      sameHex(evidence.planDigest, plan.planDigest) &&
      sameHex(evidence.sourceCommitment, plan.sourceCommitment) &&
      sameHex(
        evidence.evidenceDigest,
        digestJson(
          unsigned(evidence, "evidenceDigest"),
          CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
        ),
      ),
    "Rollforward source identity or digest differs",
  );
  isoTime(evidence.checkedAt, "rollforward source checkedAt");
  assert(
    isoTime(evidence.checkedAt, "rollforward source checkedAt") >=
      isoTime(deployment.checkedAt, "rollforward deployment checkedAt"),
    "Rollforward source evidence predates deployment evidence",
  );
  exactKeys(evidence.contracts, CLASSIC_V4_NEW_CONTRACTS, "source contracts");
  exactKeys(evidence.contracts.launcher, SOURCE_RECORD_KEYS, "launcher source record");
  assert(
    evidence.contracts.launcher.contractName ===
      CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.contractName &&
      evidence.contracts.launcher.fqcn ===
        CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET.fqcn &&
      sameHex(
        digestJson(
          evidence.contracts.launcher,
          CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.launcherSourceRecord,
        ),
        plan.lineage.launcherUpgrade.launcherSourceRecordDigest,
      ),
    "V4 launcher source record differs from rollforward lineage",
  );

  // Reuse the existing provider, URL, constructor and deployment checks after
  // projecting only the already-validated V4 source name to the legacy name.
  const projected = structuredClone(evidence);
  projected.contracts.launcher.contractName = CLASSIC_V4_SOURCE_TARGETS.launcher.contractName;
  projected.contracts.launcher.fqcn = CLASSIC_V4_SOURCE_TARGETS.launcher.fqcn;
  projected.evidenceDigest = digestJson(
    unsigned(projected, "evidenceDigest"),
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  validateClassicV4SourceEvidence(plan, deployment, projected);
  return evidence;
}

export function createClassicV4LauncherRollforwardReleaseManifest(input) {
  return createClassicV4ReleaseManifest(input, {
    validateDeploymentEvidence:
      validateClassicV4LauncherRollforwardDeploymentEvidence,
    validateSourceEvidence: validateClassicV4LauncherRollforwardSourceEvidence,
  });
}

export function createClassicV4LauncherRollforward({
  basePlan,
  baseDeploymentEvidence,
  baseSourceEvidence,
  baseArtifacts,
  upgradePlan,
  upgradeReceiptEvidence,
  upgradeVerificationEvidence,
  launcherArtifact,
  launcherSourceRecord,
  sourceCheckedAt,
}) {
  validateClassicV4PreparationPlan(basePlan, baseArtifacts);
  validateClassicV4DeploymentEvidence(basePlan, baseDeploymentEvidence);
  validateClassicV4SourceEvidence(basePlan, baseDeploymentEvidence, baseSourceEvidence);
  validateClassicV4LauncherUpgradePlan(upgradePlan, launcherArtifact);
  validateClassicV4LauncherUpgradeReceiptEvidence(upgradePlan, upgradeReceiptEvidence);
  validateClassicV4LauncherUpgradeVerificationEvidence(
    upgradePlan,
    upgradeReceiptEvidence,
    upgradeVerificationEvidence,
  );
  const expectedDependencies = expectedUpgradeDependencies(
    basePlan,
    baseDeploymentEvidence,
  );
  assert(
    basePlan.chainId === upgradePlan.chainId &&
      sameHex(basePlan.deployer, upgradePlan.deployer) &&
      !sameHex(basePlan.predictedAddresses.launcher, upgradePlan.predictedAddress) &&
      sameJson(upgradePlan.dependencies, expectedDependencies) &&
      sameJson(upgradePlan.router, {
        address: CLASSIC_V4_LAUNCH_STAMP_ROUTER,
        runtimeCodeHash: CLASSIC_V4_LAUNCH_STAMP_ROUTER_RUNTIME_CODE_HASH,
      }) &&
      upgradePlan.startingNonce >
        Math.max(...basePlan.transactions.slice(0, 3).map(({ nonce }) => nonce)) &&
      upgradeReceiptEvidence.blockNumber >
        Math.max(...OLD_CONTRACTS.map((name) => baseDeploymentEvidence.contracts[name].blockNumber)) &&
      upgradeVerificationEvidence.verificationBlock >=
        baseDeploymentEvidence.verificationBlock &&
      isoTime(sourceCheckedAt, "source checkedAt") >=
        isoTime(baseSourceEvidence.checkedAt, "base source checkedAt") &&
      isoTime(sourceCheckedAt, "source checkedAt") >=
        isoTime(upgradeVerificationEvidence.checkedAt, "upgrade checkedAt"),
    "Launcher rollforward parents are incompatible",
  );

  const artifacts = {
    ...Object.fromEntries(OLD_CONTRACTS.map((name) => [name, baseArtifacts[name]])),
    launcher: launcherArtifact,
  };
  const planBase = {
    schemaVersion: 1,
    status: "launcher-rollforward-composite",
    model: "classic",
    internalContractRelease: CLASSIC_V4_RELEASE,
    chainId: CLASSIC_V4_CHAIN_ID,
    releaseCommit: upgradePlan.releaseCommit,
    releaseTree: upgradePlan.releaseTree,
    sourceCommitment: null,
    deployer: upgradePlan.deployer,
    predictedAddresses: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [name, basePlan.predictedAddresses[name]]),
      ),
      launcher: upgradePlan.predictedAddress,
    },
    launcherFeeRecipient: basePlan.launcherFeeRecipient,
    officialDependencies: structuredClone(basePlan.officialDependencies),
    sharedDependencies: structuredClone(basePlan.sharedDependencies),
    runtimeTemplates: Object.fromEntries(
      CLASSIC_V4_NEW_CONTRACTS.map((name) => [
        name,
        structuredClone(
          name === "launcher"
            ? upgradePlan.runtimeTemplate
            : basePlan.runtimeTemplates[name],
        ),
      ]),
    ),
    artifactSourceClosures: Object.fromEntries(
      CLASSIC_V4_NEW_CONTRACTS.map((name) => [
        name,
        artifactSourceClosure(artifacts[name], name),
      ]),
    ),
    constructorArguments: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [name, basePlan.constructorArguments[name]]),
      ),
      launcher: upgradePlan.constructorArguments,
    },
    transactions: [
      ...basePlan.transactions.slice(0, 3).map((transaction) =>
        structuredClone(transaction),
      ),
      Object.fromEntries(
        Object.entries(upgradePlan.transaction).filter(([key]) => key !== "gasLimit"),
      ),
    ].map((transaction, index) => ({
      ...(index === 3 ? { name: "launcher" } : {}),
      ...transaction,
    })),
    router: structuredClone(upgradePlan.router),
    launcherDependencies: structuredClone(upgradePlan.dependencies),
    sourceTargets: structuredClone(CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS),
    lineage: {
      baseRelease: {
        releaseCommit: basePlan.releaseCommit,
        releaseTree: basePlan.releaseTree,
        sourceCommitment: basePlan.sourceCommitment,
        planDigest: basePlan.planDigest,
        deploymentEvidenceDigest: baseDeploymentEvidence.evidenceDigest,
        sourceEvidenceDigest: baseSourceEvidence.evidenceDigest,
      },
      launcherUpgrade: {
        releaseCommit: upgradePlan.releaseCommit,
        releaseTree: upgradePlan.releaseTree,
        sourceCommitment: upgradePlan.sourceCommitment,
        planDigest: upgradePlan.planDigest,
        receiptEvidenceDigest: upgradeReceiptEvidence.evidenceDigest,
        verificationEvidenceDigest: upgradeVerificationEvidence.evidenceDigest,
        launcherSourceRecordDigest: digestJson(
          launcherSourceRecord,
          CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.launcherSourceRecord,
        ),
        sourceClosureDigest: upgradePlan.sourceClosureDigest,
        sourcePinsDigest: upgradePlan.sourcePinsDigest,
      },
    },
  };
  planBase.sourceCommitment = digestJson(
    sourceMaterial(planBase),
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.sourceCommitment,
  );
  const plan = {
    ...planBase,
    planDigest: digestJson(
      planBase,
      CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.preparationPlan,
    ),
  };
  validateClassicV4LauncherRollforwardArtifacts(plan, artifacts);

  const verificationBlock = upgradeVerificationEvidence.verificationBlock;
  const contracts = {
    ...Object.fromEntries(
      OLD_CONTRACTS.map((name) => {
        const record = structuredClone(baseDeploymentEvidence.contracts[name]);
        record.confirmations = verificationBlock - record.blockNumber + 1;
        return [name, record];
      }),
    ),
    launcher: {
      transactionHash: upgradeReceiptEvidence.transactionHash,
      blockNumber: upgradeReceiptEvidence.blockNumber,
      blockHash: upgradeReceiptEvidence.blockHash,
      confirmations: verificationBlock - upgradeReceiptEvidence.blockNumber + 1,
      address: upgradeReceiptEvidence.contractAddress,
      nonce: upgradeReceiptEvidence.nonce,
      from: upgradeReceiptEvidence.from,
      to: upgradeReceiptEvidence.to,
      dataHash: upgradeReceiptEvidence.dataHash,
      value: upgradeReceiptEvidence.value,
      runtimeCodeHash: upgradeVerificationEvidence.runtimeCodeHash,
      runtimeTemplateHash: upgradeVerificationEvidence.runtimeTemplateHash,
    },
  };
  const deploymentBase = {
    schemaVersion: 1,
    chainId: CLASSIC_V4_CHAIN_ID,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "finalized",
    checkedAt: upgradeVerificationEvidence.checkedAt,
    verificationBlock,
    verificationBlockHash: upgradeVerificationEvidence.verificationBlockHash,
    independentRpcCount: 2,
    deploymentLive: true,
    runtimeCodeVerified: true,
    constructorBindingsVerified: true,
    contracts,
  };
  const deploymentEvidence = {
    ...deploymentBase,
    evidenceDigest: digestJson(
      deploymentBase,
      CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
    ),
  };
  validateClassicV4LauncherRollforwardDeploymentEvidence(plan, deploymentEvidence);

  const sourceBase = {
    schemaVersion: 1,
    chainId: CLASSIC_V4_CHAIN_ID,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    status: "verified",
    checkedAt: sourceCheckedAt,
    contracts: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [
          name,
          structuredClone(baseSourceEvidence.contracts[name]),
        ]),
      ),
      launcher: structuredClone(launcherSourceRecord),
    },
  };
  const sourceEvidence = {
    ...sourceBase,
    evidenceDigest: digestJson(sourceBase, CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence),
  };
  validateClassicV4LauncherRollforwardSourceEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  return { plan, deploymentEvidence, sourceEvidence };
}
