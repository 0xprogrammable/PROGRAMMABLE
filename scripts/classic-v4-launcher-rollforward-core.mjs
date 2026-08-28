import {
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  getCreate2Address,
  keccak256,
  parseAbi,
} from "viem";

import {
  CLASSIC_V4_CHAIN_ID,
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_NEW_CONTRACTS,
  CLASSIC_V4_RELEASE,
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
  CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT,
  CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT,
  CLASSIC_V4_LAUNCHER_UPGRADE_RELEASE,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
  classicV4LauncherUpgradeConstructorArguments,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "./classic-v4-launcher-upgrade-core.mjs";

const OLD_CONTRACTS = Object.freeze([
  "hookFactory",
  "feeHook",
  "positionPlanner",
]);
const hookFactoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient,address feeSplitVaultFactory) returns (address hook)",
]);

export const CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR = Object.freeze({
  releaseCommit: "82d711a8343de5aed0ae089759069c81fc6864db",
  releaseTree: "27f75eeb90ab138e22c8beac12e83e102ca74428",
  sourceCommitment:
    "0xa666b8a82291e1d6f791306d7f997c9fb09a3d95b39c610c1a24003b4a05fb61",
  planDigest:
    "0xa918b168e4b1dab5988e7d103d4c9457856f3745d1b9849664585672924efa7a",
  deploymentEvidenceDigest:
    "0xf289fc3fa2afd441ec6224964cdd8dd1824c8ad4105888b55bf4de242cd2a112",
  sourceEvidenceDigest:
    "0x5e476a74127477952ab7345bb5c9e4c7339a08d15c82fc88433fca3b2945020f",
  deployer: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  predictedAddresses: Object.freeze({
    hookFactory: "0xbE0aa4081Ab586321BC55197E67135C191d532A9",
    feeHook: "0xADF955a44FD7F009380240d56D71dFAfB46020cc",
    positionPlanner: "0xD8f8f5C5832648d59a5f465f8Dd02d36572D4A6c",
    launcher: "0x1af508f9aF9f8f5Cf7bf712B7d2974D4eE7A6681",
  }),
});

export const CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS = Object.freeze({
  parentBundle: "programmable.classic-v4.launcher-rollforward-parent-bundle.v1",
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

function exactKeys(value, keys, label) {
  const actual = Object.keys(value ?? {}).sort();
  const expected = [...keys].sort();
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} keys differ`,
  );
}

function sameHex(left, right) {
  return normalizeHex(left) === normalizeHex(right);
}

function sameJson(left, right) {
  return digestJson(left) === digestJson(right);
}

function without(value, key) {
  return Object.fromEntries(
    Object.entries(value).filter(([entry]) => entry !== key),
  );
}

function nonzeroHash(value, label) {
  const hash = assertBytes32(value, label);
  assert(BigInt(hash) !== 0n, `Invalid ${label}`);
  return hash;
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

function gitObject(value, label) {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{40}$/i.test(value) &&
      value !== "0".repeat(40),
    `Invalid ${label}`,
  );
  return value.toLowerCase();
}

function decimal(value, label, { positive = false } = {}) {
  assert(
    typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value),
    `Invalid ${label}`,
  );
  const parsed = BigInt(value);
  assert(!positive || parsed > 0n, `Invalid ${label}`);
  return parsed;
}

function transactionProjection(transaction, name = transaction.name) {
  return {
    name,
    transactionType: transaction.transactionType,
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce,
    value: transaction.value,
    predictedAddress: transaction.predictedAddress,
    dataHash: transaction.dataHash,
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

function validateBaseParent(plan, deployment, source) {
  assert(
    plan.releaseCommit ===
      CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.releaseCommit &&
      plan.releaseTree ===
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.releaseTree &&
      sameHex(
        plan.sourceCommitment,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.sourceCommitment,
      ) &&
      sameHex(
        plan.planDigest,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.planDigest,
      ) &&
      sameHex(
        deployment.evidenceDigest,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.deploymentEvidenceDigest,
      ) &&
      sameHex(
        source.evidenceDigest,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.sourceEvidenceDigest,
      ) &&
      sameHex(
        plan.deployer,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.deployer,
      ) &&
      sameJson(
        plan.predictedAddresses,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_BASE_ANCHOR.predictedAddresses,
      ) &&
      sameHex(
        plan.planDigest,
        digestJson(
          without(plan, "planDigest"),
          CLASSIC_V4_DIGEST_DOMAINS.preparationPlan,
        ),
      ),
    "Embedded base parent differs from the canonical deployed release",
  );
  validateClassicV4DeploymentEvidence(plan, deployment);
  validateClassicV4SourceEvidence(plan, deployment, source);

  const deployer = canonicalNonzeroAddress(plan.deployer, "base deployer");
  const expectedAddresses = {
    hookFactory: getContractAddress({
      from: deployer,
      nonce: BigInt(plan.startingNonce),
    }),
    feeHook: getCreate2Address({
      from: plan.predictedAddresses.hookFactory,
      salt: plan.hookSalt,
      bytecodeHash: plan.hookInitCodeHash,
    }),
    positionPlanner: getContractAddress({
      from: deployer,
      nonce: BigInt(plan.startingNonce + 2),
    }),
    launcher: getContractAddress({
      from: deployer,
      nonce: BigInt(plan.startingNonce + 3),
    }),
  };
  assert(
    sameJson(plan.predictedAddresses, expectedAddresses),
    "Embedded base CREATE/CREATE2 address ancestry differs",
  );
  const feeHookCall = encodeFunctionData({
    abi: hookFactoryAbi,
    functionName: "deploy",
    args: [
      plan.hookSalt,
      plan.officialDependencies.poolManager.address,
      plan.launcherFeeRecipient,
      plan.sharedDependencies.rewardVaultFactory.address,
    ],
  });
  const hookArguments = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [
      plan.officialDependencies.poolManager.address,
      plan.launcherFeeRecipient,
      plan.sharedDependencies.rewardVaultFactory.address,
    ],
  );
  for (const [index, name] of CLASSIC_V4_NEW_CONTRACTS.entries()) {
    const transaction = plan.transactions[index];
    assert(
      transaction.name === name &&
        transaction.nonce === plan.startingNonce + index &&
        sameHex(transaction.from, deployer) &&
        (name === "feeHook"
          ? sameHex(transaction.to, plan.predictedAddresses.hookFactory)
          : transaction.to === null) &&
        sameHex(transaction.predictedAddress, plan.predictedAddresses[name]) &&
        sameHex(transaction.dataHash, keccak256(transaction.data)),
      `Embedded base ${name} transaction ancestry differs`,
    );
  }
  assert(
    sameHex(
      plan.transactions[0].dataHash,
      plan.runtimeTemplates.hookFactory.creationCodeHash,
    ) &&
      sameHex(plan.transactions[1].dataHash, keccak256(feeHookCall)) &&
      sameHex(
        plan.transactions[2].dataHash,
        plan.runtimeTemplates.positionPlanner.creationCodeHash,
      ) &&
      sameHex(plan.constructorArguments.feeHook, hookArguments),
    "Embedded retained artifacts or factory call differ",
  );
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
      "schemaVersion",
      "status",
      "chainId",
      "planDigest",
      "receiptEvidenceDigest",
      "sourceCommitment",
      "verificationBlock",
      "verificationBlockHash",
      "checkedAt",
      "independentRpcCount",
      "confirmations",
      "transactionHash",
      "contractAddress",
      "runtimeCodeHash",
      "runtimeTemplateHash",
      "dependencyRuntimeVerified",
      "dependencyBindingsVerified",
      "constructorBindingsVerified",
      "canonicalRouterVerified",
      "evidenceDigest",
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
      ) &&
      Number.isSafeInteger(evidence.verificationBlock) &&
      evidence.confirmations ===
        evidence.verificationBlock - receipt.blockNumber + 1 &&
      evidence.confirmations >= 12 &&
      evidence.independentRpcCount === 2 &&
      evidence.dependencyRuntimeVerified === true &&
      evidence.dependencyBindingsVerified === true &&
      evidence.constructorBindingsVerified === true &&
      evidence.canonicalRouterVerified === true,
    "Launcher verification identity or finality differs",
  );
  nonzeroHash(
    evidence.verificationBlockHash,
    "launcher verification block hash",
  );
  nonzeroHash(evidence.runtimeCodeHash, "launcher runtime code hash");
  isoTime(evidence.checkedAt, "launcher verification checkedAt");
  assert(
    sameHex(
      evidence.evidenceDigest,
      digestJson(
        without(evidence, "evidenceDigest"),
        CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.verificationEvidence,
      ),
    ),
    "Launcher verification digest differs",
  );
  return evidence;
}

function validateUpgradeParent(
  basePlan,
  baseDeployment,
  plan,
  receipt,
  verification,
) {
  exactKeys(
    plan,
    [
      "schemaVersion",
      "status",
      "model",
      "internalContractRelease",
      "chainId",
      "releaseCommit",
      "releaseTree",
      "sourceCommitment",
      "sourceClosureDigest",
      "sourcePinsDigest",
      "deployer",
      "startingNonce",
      "observedAtBlock",
      "observedAtBlockHash",
      "predictedAddress",
      "dependencies",
      "router",
      "runtimeTemplate",
      "constructorArguments",
      "transaction",
      "preflight",
      "executionBoundary",
      "planDigest",
    ],
    "launcher upgrade parent plan",
  );
  exactKeys(
    plan.transaction,
    [
      "transactionType",
      "from",
      "to",
      "nonce",
      "value",
      "predictedAddress",
      "data",
      "dataHash",
      "gasLimit",
    ],
    "launcher upgrade transaction",
  );
  exactKeys(
    plan.runtimeTemplate,
    [
      "bytes",
      "creationCodeHash",
      "runtimeTemplateHash",
      "immutableReferenceCount",
    ],
    "launcher upgrade runtime template",
  );
  exactKeys(
    plan.preflight,
    [
      "independentRpcCount",
      "freshDeterministicBuild",
      "sourcePinsVerified",
      "dependencyRuntimeVerified",
      "dependencyBindingsVerified",
      "canonicalRouterVerified",
      "constructorSimulationVerified",
      "predictedAddressVacant",
      "deployerNonceReconciled",
      "deployerBalanceVerified",
      "estimatedGas",
      "reviewedGasLimit",
      "gasPriceWei",
      "deployerBalanceWei",
      "requiredBalanceWei",
    ],
    "launcher upgrade preflight",
  );
  exactKeys(
    plan.executionBoundary,
    ["signs", "broadcasts", "writes", "ownerApprovalRequiredForDeployment"],
    "launcher upgrade execution boundary",
  );
  const constructorArguments = classicV4LauncherUpgradeConstructorArguments();
  const constructorSuffix = constructorArguments.slice(2).toLowerCase();
  const transactionData = plan.transaction.data.toLowerCase();
  assert(
    /^0x[0-9a-f]+$/.test(transactionData) &&
      transactionData.endsWith(constructorSuffix),
    "Launcher upgrade creation data differs",
  );
  const creationCode = transactionData.slice(0, -constructorSuffix.length);
  const estimatedGas = decimal(
    plan.preflight.estimatedGas,
    "launcher estimated gas",
    { positive: true },
  );
  const reviewedGasLimit = decimal(
    plan.preflight.reviewedGasLimit,
    "launcher reviewed gas limit",
    { positive: true },
  );
  const gasPriceWei = decimal(
    plan.preflight.gasPriceWei,
    "launcher gas price",
    { positive: true },
  );
  const deployerBalanceWei = decimal(
    plan.preflight.deployerBalanceWei,
    "launcher deployer balance",
    { positive: true },
  );
  const requiredBalanceWei = decimal(
    plan.preflight.requiredBalanceWei,
    "launcher required balance",
    { positive: true },
  );
  const predictedAddress = getContractAddress({
    from: canonicalNonzeroAddress(plan.deployer, "launcher upgrade deployer"),
    nonce: BigInt(plan.startingNonce),
  });
  assert(
    plan.schemaVersion === 1 &&
      plan.status === "simulation-only" &&
      plan.model === "classic" &&
      plan.internalContractRelease === CLASSIC_V4_LAUNCHER_UPGRADE_RELEASE &&
      plan.chainId === CLASSIC_V4_CHAIN_ID &&
      gitObject(plan.releaseCommit, "launcher upgrade release commit") ===
        plan.releaseCommit.toLowerCase() &&
      gitObject(plan.releaseTree, "launcher upgrade release tree") ===
        plan.releaseTree.toLowerCase() &&
      Number.isSafeInteger(plan.observedAtBlock) &&
      plan.observedAtBlock > baseDeployment.verificationBlock &&
      nonzeroHash(
        plan.observedAtBlockHash,
        "launcher upgrade observed block hash",
      ) &&
      nonzeroHash(plan.sourceClosureDigest, "launcher source closure digest") &&
      nonzeroHash(plan.sourcePinsDigest, "launcher source pins digest") &&
      sameJson(
        plan.dependencies,
        expectedUpgradeDependencies(basePlan, baseDeployment),
      ) &&
      sameJson(plan.dependencies, CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES) &&
      sameJson(plan.router, CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER) &&
      sameHex(plan.constructorArguments, constructorArguments) &&
      sameHex(plan.predictedAddress, predictedAddress) &&
      plan.transaction.transactionType === "CREATE" &&
      sameHex(plan.transaction.from, plan.deployer) &&
      plan.transaction.to === null &&
      plan.transaction.nonce === plan.startingNonce &&
      plan.transaction.value === "0" &&
      sameHex(plan.transaction.predictedAddress, plan.predictedAddress) &&
      sameHex(plan.transaction.dataHash, keccak256(plan.transaction.data)) &&
      sameHex(plan.runtimeTemplate.creationCodeHash, keccak256(creationCode)) &&
      Number.isSafeInteger(plan.runtimeTemplate.bytes) &&
      plan.runtimeTemplate.bytes > 0 &&
      plan.runtimeTemplate.bytes <= 24_576 &&
      Number.isSafeInteger(plan.runtimeTemplate.immutableReferenceCount) &&
      plan.runtimeTemplate.immutableReferenceCount >= 0 &&
      nonzeroHash(
        plan.runtimeTemplate.runtimeTemplateHash,
        "launcher runtime template hash",
      ) &&
      plan.transaction.gasLimit === plan.preflight.reviewedGasLimit &&
      estimatedGas <= reviewedGasLimit &&
      reviewedGasLimit >= CLASSIC_V4_LAUNCHER_UPGRADE_MIN_GAS_LIMIT &&
      reviewedGasLimit <= CLASSIC_V4_LAUNCHER_UPGRADE_MAX_GAS_LIMIT &&
      gasPriceWei > 0n &&
      deployerBalanceWei >= requiredBalanceWei &&
      sameHex(
        plan.sourceCommitment,
        digestJson(
          {
            contract: CLASSIC_V4_LAUNCHER_UPGRADE_SOURCE_TARGET,
            artifact: plan.runtimeTemplate,
            sourceClosureDigest: plan.sourceClosureDigest,
            sourcePinsDigest: plan.sourcePinsDigest,
            dependencies: plan.dependencies,
            router: plan.router,
            constructorArguments: plan.constructorArguments,
          },
          CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.sourceCommitment,
        ),
      ) &&
      sameHex(
        plan.planDigest,
        digestJson(
          without(plan, "planDigest"),
          CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.preparationPlan,
        ),
      ) &&
      sameHex(plan.deployer, basePlan.deployer) &&
      plan.preflight.independentRpcCount === 2 &&
      [
        "freshDeterministicBuild",
        "sourcePinsVerified",
        "dependencyRuntimeVerified",
        "dependencyBindingsVerified",
        "canonicalRouterVerified",
        "constructorSimulationVerified",
        "predictedAddressVacant",
        "deployerNonceReconciled",
        "deployerBalanceVerified",
      ].every((key) => plan.preflight[key] === true) &&
      plan.executionBoundary.signs === false &&
      plan.executionBoundary.broadcasts === false &&
      plan.executionBoundary.writes === false &&
      plan.executionBoundary.ownerApprovalRequiredForDeployment === true &&
      !sameHex(plan.predictedAddress, basePlan.predictedAddresses.launcher) &&
      plan.startingNonce >
        Math.max(...basePlan.transactions.map(({ nonce }) => nonce)) &&
      receipt.blockNumber > plan.observedAtBlock &&
      receipt.blockNumber >
        Math.max(
          ...Object.values(baseDeployment.contracts).map(
            ({ blockNumber }) => blockNumber,
          ),
        ) &&
      verification.verificationBlock >= baseDeployment.verificationBlock,
    "Embedded launcher upgrade parent differs from the canonical base",
  );
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, receipt);
  validateClassicV4LauncherUpgradeVerificationEvidence(
    plan,
    receipt,
    verification,
  );
}

export function validateClassicV4LauncherRollforwardParentBundle(bundle) {
  exactKeys(
    bundle,
    ["schemaVersion", "base", "launcherUpgrade", "bundleDigest"],
    "launcher rollforward parent bundle",
  );
  exactKeys(
    bundle.base,
    ["plan", "deploymentEvidence", "sourceEvidence"],
    "base parent bundle",
  );
  exactKeys(
    bundle.launcherUpgrade,
    ["plan", "receiptEvidence", "verificationEvidence"],
    "launcher upgrade parent bundle",
  );
  assert(bundle.schemaVersion === 1, "Parent bundle schema differs");
  validateBaseParent(
    bundle.base.plan,
    bundle.base.deploymentEvidence,
    bundle.base.sourceEvidence,
  );
  validateUpgradeParent(
    bundle.base.plan,
    bundle.base.deploymentEvidence,
    bundle.launcherUpgrade.plan,
    bundle.launcherUpgrade.receiptEvidence,
    bundle.launcherUpgrade.verificationEvidence,
  );
  assert(
    sameHex(
      bundle.bundleDigest,
      digestJson(
        without(bundle, "bundleDigest"),
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.parentBundle,
      ),
    ),
    "Launcher rollforward parent bundle digest differs",
  );
  return bundle;
}

export function createClassicV4LauncherRollforwardParentBundle({
  basePlan,
  baseDeploymentEvidence,
  baseSourceEvidence,
  baseArtifacts,
  upgradePlan,
  upgradeReceiptEvidence,
  upgradeVerificationEvidence,
  launcherArtifact,
}) {
  validateClassicV4PreparationPlan(basePlan, baseArtifacts);
  validateClassicV4LauncherUpgradePlan(upgradePlan, launcherArtifact);
  const body = {
    schemaVersion: 1,
    base: {
      plan: structuredClone(basePlan),
      deploymentEvidence: structuredClone(baseDeploymentEvidence),
      sourceEvidence: structuredClone(baseSourceEvidence),
    },
    launcherUpgrade: {
      plan: structuredClone(upgradePlan),
      receiptEvidence: structuredClone(upgradeReceiptEvidence),
      verificationEvidence: structuredClone(upgradeVerificationEvidence),
    },
  };
  const bundle = {
    ...body,
    bundleDigest: digestJson(
      body,
      CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.parentBundle,
    ),
  };
  return validateClassicV4LauncherRollforwardParentBundle(bundle);
}

function planBody(parentBundle) {
  const base = parentBundle.base.plan;
  const upgrade = parentBundle.launcherUpgrade.plan;
  const body = {
    schemaVersion: 1,
    status: "launcher-rollforward-composite",
    model: "classic",
    internalContractRelease: CLASSIC_V4_RELEASE,
    chainId: CLASSIC_V4_CHAIN_ID,
    releaseCommit: upgrade.releaseCommit,
    releaseTree: upgrade.releaseTree,
    sourceCommitment: null,
    deployer: upgrade.deployer,
    predictedAddresses: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [name, base.predictedAddresses[name]]),
      ),
      launcher: upgrade.predictedAddress,
    },
    launcherFeeRecipient: base.launcherFeeRecipient,
    officialDependencies: structuredClone(base.officialDependencies),
    sharedDependencies: structuredClone(base.sharedDependencies),
    runtimeTemplates: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [
          name,
          structuredClone(base.runtimeTemplates[name]),
        ]),
      ),
      launcher: structuredClone(upgrade.runtimeTemplate),
    },
    constructorArguments: {
      ...Object.fromEntries(
        OLD_CONTRACTS.map((name) => [name, base.constructorArguments[name]]),
      ),
      launcher: upgrade.constructorArguments,
    },
    transactions: [
      ...base.transactions
        .slice(0, 3)
        .map((transaction) => transactionProjection(transaction)),
      transactionProjection(upgrade.transaction, "launcher"),
    ],
    router: structuredClone(upgrade.router),
    sourceTargets: structuredClone(
      CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
    ),
    parentBundle: structuredClone(parentBundle),
  };
  body.sourceCommitment = digestJson(
    {
      parentBundleDigest: parentBundle.bundleDigest,
      releaseCommit: body.releaseCommit,
      releaseTree: body.releaseTree,
      predictedAddresses: body.predictedAddresses,
      runtimeTemplates: body.runtimeTemplates,
      constructorArguments: body.constructorArguments,
      router: body.router,
      sourceTargets: body.sourceTargets,
    },
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.sourceCommitment,
  );
  return body;
}

export function createClassicV4LauncherRollforwardPlan({ parentBundle }) {
  validateClassicV4LauncherRollforwardParentBundle(parentBundle);
  const body = planBody(parentBundle);
  return {
    ...body,
    planDigest: digestJson(
      body,
      CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.preparationPlan,
    ),
  };
}

export function validateClassicV4LauncherRollforwardPlan(plan) {
  validateClassicV4LauncherRollforwardParentBundle(plan?.parentBundle);
  const expected = createClassicV4LauncherRollforwardPlan({
    parentBundle: plan.parentBundle,
  });
  assert(
    sameJson(plan, expected),
    "Launcher rollforward plan differs from its parents",
  );
  return plan;
}

export function validateClassicV4LauncherRollforwardArtifacts(
  plan,
  artifacts,
  { baseArtifacts } = {},
) {
  validateClassicV4LauncherRollforwardPlan(plan);
  exactKeys(artifacts, CLASSIC_V4_NEW_CONTRACTS, "rollforward artifacts");
  exactKeys(baseArtifacts, CLASSIC_V4_NEW_CONTRACTS, "base artifacts");
  validateClassicV4PreparationPlan(plan.parentBundle.base.plan, baseArtifacts);
  validateClassicV4LauncherUpgradePlan(
    plan.parentBundle.launcherUpgrade.plan,
    artifacts.launcher,
  );
  for (const name of OLD_CONTRACTS) {
    assert(
      sameJson(artifacts[name], baseArtifacts[name]) &&
        sameJson(
          artifactRuntimeDescriptor(artifacts[name], name),
          plan.parentBundle.base.plan.runtimeTemplates[name],
        ) &&
        sameJson(
          artifactRuntimeDescriptor(baseArtifacts[name], name),
          plan.runtimeTemplates[name],
        ),
      `${name} retained artifact differs from the canonical parent`,
    );
  }
  assert(
    sameJson(
      artifactRuntimeDescriptor(artifacts.launcher, "launcher"),
      plan.runtimeTemplates.launcher,
    ),
    "Launcher artifact differs from the upgrade parent",
  );
  return artifacts;
}

function sameDeploymentAncestry(actual, expected) {
  const keys = [
    "transactionHash",
    "blockNumber",
    "blockHash",
    "address",
    "nonce",
    "from",
    "to",
    "dataHash",
    "value",
    "runtimeCodeHash",
    "runtimeTemplateHash",
  ];
  return keys.every((key) =>
    typeof expected[key] === "string"
      ? sameHex(actual[key], expected[key])
      : actual[key] === expected[key],
  );
}

export function validateClassicV4LauncherRollforwardDeploymentEvidence(
  plan,
  evidence,
) {
  validateClassicV4LauncherRollforwardPlan(plan);
  const deployment = validateClassicV4DeploymentEvidence(plan, evidence);
  const parents = plan.parentBundle;
  const base = parents.base.deploymentEvidence;
  const upgradeReceipt = parents.launcherUpgrade.receiptEvidence;
  const upgradeFinal = parents.launcherUpgrade.verificationEvidence;
  const expectedLauncher = {
    transactionHash: upgradeReceipt.transactionHash,
    blockNumber: upgradeReceipt.blockNumber,
    blockHash: upgradeReceipt.blockHash,
    address: upgradeReceipt.contractAddress,
    nonce: upgradeReceipt.nonce,
    from: upgradeReceipt.from,
    to: upgradeReceipt.to,
    dataHash: upgradeReceipt.dataHash,
    value: upgradeReceipt.value,
    runtimeCodeHash: upgradeFinal.runtimeCodeHash,
    runtimeTemplateHash: upgradeFinal.runtimeTemplateHash,
  };
  assert(
    evidence.independentRpcCount === 2 &&
      evidence.verificationBlock >= base.verificationBlock &&
      evidence.verificationBlock === upgradeFinal.verificationBlock &&
      sameHex(
        evidence.verificationBlockHash,
        upgradeFinal.verificationBlockHash,
      ) &&
      isoTime(evidence.checkedAt, "common-head deployment checkedAt") ===
        isoTime(upgradeFinal.checkedAt, "upgrade verification checkedAt") &&
      isoTime(evidence.checkedAt, "common-head deployment checkedAt") >
        isoTime(base.checkedAt, "base deployment checkedAt") &&
      OLD_CONTRACTS.every((name) =>
        sameDeploymentAncestry(evidence.contracts[name], base.contracts[name]),
      ) &&
      sameDeploymentAncestry(evidence.contracts.launcher, expectedLauncher),
    "Composite deployment is not a fresh common-head replay of both parents",
  );
  return deployment;
}

export function validateClassicV4LauncherRollforwardSourceEvidence(
  plan,
  deployment,
  evidence,
) {
  validateClassicV4LauncherRollforwardDeploymentEvidence(plan, deployment);
  validateClassicV4SourceEvidence(plan, deployment, evidence, {
    sourceTargets: CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
  });
  const parents = plan.parentBundle;
  assert(
    isoTime(evidence.checkedAt, "common source checkedAt") >
      Math.max(
        isoTime(deployment.checkedAt, "common deployment checkedAt"),
        isoTime(parents.base.sourceEvidence.checkedAt, "base source checkedAt"),
        isoTime(
          parents.launcherUpgrade.verificationEvidence.checkedAt,
          "upgrade verification checkedAt",
        ),
      ),
    "Composite source evidence is not a fresh all-contract provider capture",
  );
  return evidence;
}

export function createClassicV4LauncherRollforward({
  parentBundle,
  commonHeadDeploymentEvidence,
  commonHeadSourceEvidence,
}) {
  const plan = createClassicV4LauncherRollforwardPlan({ parentBundle });
  validateClassicV4LauncherRollforwardDeploymentEvidence(
    plan,
    commonHeadDeploymentEvidence,
  );
  validateClassicV4LauncherRollforwardSourceEvidence(
    plan,
    commonHeadDeploymentEvidence,
    commonHeadSourceEvidence,
  );
  return {
    plan,
    deploymentEvidence: commonHeadDeploymentEvidence,
    sourceEvidence: commonHeadSourceEvidence,
  };
}

export function createClassicV4LauncherRollforwardReleaseManifest(input) {
  validateClassicV4LauncherRollforwardPlan(input?.plan);
  return createClassicV4ReleaseManifest(input, {
    validateDeploymentEvidence:
      validateClassicV4LauncherRollforwardDeploymentEvidence,
    validateSourceEvidence: validateClassicV4LauncherRollforwardSourceEvidence,
  });
}
