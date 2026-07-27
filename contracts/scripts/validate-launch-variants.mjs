import { readFile } from "node:fs/promises";

const specificationDirectory = new URL("../spec/", import.meta.url);
const configurationDirectory = new URL("../config/", import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(directory, file) {
  return JSON.parse(await readFile(new URL(file, directory), "utf8"));
}

const [
  catalog,
  memeStandard,
  directStandard,
  existingUerc20Standard,
  auctionStandard,
  dynamicFeeStandard,
  behaviorCatalog,
  deployment,
  appDeployments,
] = await Promise.all([
  readJson(specificationDirectory, "launch-variants.v1.json"),
  readJson(specificationDirectory, "meme-eth-fee-locked-v1.json"),
  readJson(specificationDirectory, "direct-standard-v1.json"),
  readJson(specificationDirectory, "existing-uerc20-standard-v1.json"),
  readJson(specificationDirectory, "verified-standard-v1.json"),
  readJson(specificationDirectory, "bounded-dynamic-fee-v1.json"),
  readJson(specificationDirectory, "behavior-modules.v1.json"),
  readJson(configurationDirectory, "deployment-inputs.v1.json"),
  readJson(configurationDirectory, "app-deployments.v1.json"),
]);

assert(catalog.schemaVersion === 1, "Unsupported launch catalog schema");
assert(Array.isArray(catalog.variants), "Launch variants are missing");
assert(catalog.variants.length > 0, "Launch catalog is empty");
assert(
  catalog.publicCatalog?.otherVariantsVisible === false,
  "Only the active launch product may be visible",
);

const validStatuses = new Set(Object.keys(catalog.statusDefinitions));
const variantIds = new Set();
const protocolTestedIds = new Set();

for (const variant of catalog.variants) {
  assert(typeof variant.id === "string" && variant.id, "Variant ID is missing");
  assert(!variantIds.has(variant.id), `Duplicate variant ID ${variant.id}`);
  variantIds.add(variant.id);

  assert(
    validStatuses.has(variant.status),
    `${variant.id} uses undefined status ${variant.status}`,
  );
  assert(
    typeof variant.humanSummary === "string" && variant.humanSummary,
    `${variant.id} has no human summary`,
  );

  for (const axis of catalog.compositionAxes) {
    assert(variant[axis], `${variant.id} is missing composition axis ${axis}`);
  }

  if (variant.status === "protocol-tested") {
    assert(
      Array.isArray(variant.implementation) && variant.implementation.length > 0,
      `${variant.id} has no implementation evidence`,
    );
    assert(
      Array.isArray(variant.evidence) && variant.evidence.length > 0,
      `${variant.id} has no test evidence`,
    );
    protocolTestedIds.add(variant.id);
  }
}

assert(
  variantIds.has(catalog.publicCatalog.activeVariantId),
  "The active public launch product is missing from the catalog",
);
assert(
  catalog.publicCatalog.activeVariantId ===
    "meme-eth-fee-locked-v1",
  "Classic must remain the only public product in V1",
);
assert(
  catalog.publicCatalog.displayName === "Classic",
  "The public product name must remain Classic",
);
assert(
  protocolTestedIds.size === 1 &&
    protocolTestedIds.has(catalog.publicCatalog.activeVariantId),
  "Only Classic may be marked as the active protocol-tested product",
);
for (const variant of catalog.variants) {
  if (variant.id === catalog.publicCatalog.activeVariantId) continue;
  assert(
    variant.status === "archived",
    `${variant.id} must remain archived and outside the public product`,
  );
}

assert(
  memeStandard.productionApproved === false,
  "Classic must not claim production approval",
);
assert(
  memeStandard.token.wholeTokenSupply === "1000000000" &&
    memeStandard.token.decimals === 18 &&
    memeStandard.token.creatorTokenAllocation === "0",
  "Classic must keep its fixed one-billion-token policy with no creator allocation",
);
assert(
  memeStandard.launch.payable === true &&
    memeStandard.launch.launcherFeeAtCreation === "0" &&
    memeStandard.launch.creatorLiquidityDeposit === "0" &&
    memeStandard.launch.minimumInitialCreatorBuyWei ===
      "600000000000000" &&
    memeStandard.launch.initialCreatorBuyPolicy ===
      "creator-selected-atomic-market-buy-at-or-above-minimum" &&
    memeStandard.launch.initialBuyRecipient === "launch-creator",
  "Classic must require a creator-selected Dev Buy at or above the minimum without a launch fee or liquidity deposit",
);
assert(
  memeStandard.metadata.officialTuple ===
    "(string description,string website,string image,bytes extraData)" &&
    memeStandard.metadata.limitsUtf8Bytes.name === 48 &&
    memeStandard.metadata.limitsUtf8Bytes.symbol === 12 &&
    memeStandard.metadata.limitsUtf8Bytes.description === 280 &&
    memeStandard.metadata.limitsUtf8Bytes.website === 2048 &&
    memeStandard.metadata.limitsUtf8Bytes.image === 2048 &&
    memeStandard.metadata.limitsUtf8Bytes.extraData === 1200 &&
    memeStandard.metadata.frontendUrlPolicy ===
      "optional-bounded-https" &&
    memeStandard.metadata.contractPolicy === "utf8-byte-limits-only",
  "Classic metadata policy differs from the contract and app limits",
);
const calculatedStartingFdvEth =
  Number(memeStandard.token.wholeTokenSupply) /
  1.0001 ** memeStandard.pool.initialTick;
assert(
  memeStandard.pool.initialTick === 204200 &&
    memeStandard.pool.tickSpacing === 200 &&
    memeStandard.pool.startingValuation.measure ===
      "fully-diluted-value" &&
    Math.abs(
      Number(memeStandard.pool.startingValuation.startingFdvNativeEth) -
        calculatedStartingFdvEth,
    ) < 1e-9,
  "Classic starting FDV differs from its fixed supply and initial tick",
);
assert(
  memeStandard.swapFee.selectedTotalFeeBps.minimum === 100 &&
    memeStandard.swapFee.selectedTotalFeeBps.maximum === 1000 &&
    memeStandard.swapFee.selectedTotalFeeBps.step === 100 &&
    memeStandard.swapFee.launcherShareBps === 10 &&
    memeStandard.swapFee.launcherShareIsAddedOnTop === false &&
    memeStandard.swapFee.recipientRecovery ===
      "recorded-recipient-only-redirect",
  "Classic fee split differs from the selected-total rule",
);
assert(
  deployment.platform.memeLaunchFeeAtCreation === "0" &&
    deployment.platform.memeMinimumInitialCreatorBuyWei ===
      memeStandard.launch.minimumInitialCreatorBuyWei &&
    deployment.platform.memeInitialCreatorBuyPolicy ===
      memeStandard.launch.initialCreatorBuyPolicy &&
    deployment.platform.memeInitialCreatorBuyRecipient ===
      memeStandard.launch.initialBuyRecipient &&
    deployment.platform.memeLauncherShareBps === 10 &&
    deployment.platform.memeLauncherSharePolicy ===
      "deducted-from-selected-total-not-added-on-top",
  "Classic deployment inputs differ from the initial-buy and inclusive fee rules",
);
assert(
  deployment.liquidityPosition.failedNativePayoutRecovery ===
    "recorded-recipient-only-redirect",
  "Classic claim recovery policy differs from the contract",
);
assert(
  deployment.deployment.productionSigner ===
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E" &&
    deployment.deployment.productionSigner.toLowerCase() ===
      deployment.deployment.testWallet.toLowerCase() &&
    deployment.deployment.productionSignerPolicy ===
      "owner-approved-eoa-manual-wallet-signing-no-key-storage" &&
    deployment.deployment.privateKeysStoredInRepository === false,
  "The owner-approved Mainnet signer policy is not recorded",
);

assert(
  directStandard.productionApproved === false,
  "Direct standard must not claim production approval",
);
assert(
  auctionStandard.productionApproved === false,
  "Auction standard must not claim production approval",
);
assert(
  auctionStandard.token.wholeTokenSupply === "1000000000" &&
    auctionStandard.token.decimals === 18,
  "Standard Launch must keep the fixed one billion token policy",
);
assert(
  existingUerc20Standard.productionApproved === false,
  "Existing UERC20 standard must not claim production approval",
);
assert(
  dynamicFeeStandard.productionApproved === false,
  "Bounded dynamic fee standard must not claim production approval",
);
assert(
  directStandard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Direct standard fee differs from deployment configuration",
);
assert(
  auctionStandard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Auction standard fee differs from deployment configuration",
);
assert(
  existingUerc20Standard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Existing UERC20 standard fee differs from deployment configuration",
);
assert(
  dynamicFeeStandard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Bounded dynamic fee standard differs from deployment configuration",
);

const configuredTreasury = deployment.platform.treasury.toLowerCase();
assert(
  catalog.verifiedBoundary.treasury.toLowerCase() === configuredTreasury,
  "Launch catalog treasury differs from deployment configuration",
);
assert(
  memeStandard.swapFee.launcherRecipient.toLowerCase() === configuredTreasury,
  "Classic treasury differs from deployment configuration",
);
assert(
  directStandard.platformFee.treasury.toLowerCase() === configuredTreasury,
  "Direct standard treasury differs from deployment configuration",
);
assert(
  auctionStandard.platformFee.treasury.toLowerCase() === configuredTreasury,
  "Auction standard treasury differs from deployment configuration",
);
assert(
  existingUerc20Standard.platformFee.treasury.toLowerCase() ===
    configuredTreasury,
  "Existing UERC20 standard treasury differs from deployment configuration",
);
assert(
  dynamicFeeStandard.platformFee.treasury.toLowerCase() ===
    configuredTreasury,
  "Bounded dynamic fee treasury differs from deployment configuration",
);

const behaviorIds = new Set();
for (const behavior of behaviorCatalog.modules) {
  assert(
    typeof behavior.id === "string" && behavior.id,
    "Behavior module ID is missing",
  );
  assert(
    !behaviorIds.has(behavior.id),
    `Duplicate behavior module ID ${behavior.id}`,
  );
  behaviorIds.add(behavior.id);
  assert(
    Array.isArray(behavior.invariants) && behavior.invariants.length > 0,
    `${behavior.id} has no invariants`,
  );
}

assert(
  behaviorIds.has("SYS-01") &&
    behaviorIds.has("SYS-02") &&
    behaviorIds.has("SYS-03") &&
    behaviorIds.has("M-01") &&
    behaviorIds.has("C-01"),
  "A required V1 behavior module is missing",
);

assert(
  appDeployments.schemaVersion === 1,
  "Unsupported app deployment schema",
);
assert(
  appDeployments.production.chainId ===
    deployment.network.productionChainId,
  "App production chain differs from deployment inputs",
);
assert(
  appDeployments.rehearsal.chainId ===
    deployment.network.rehearsalChainId,
  "App rehearsal chain differs from deployment inputs",
);

for (const [environment, manifest] of Object.entries({
  production: appDeployments.production,
  rehearsal: appDeployments.rehearsal,
})) {
  assert(
    ["classic-v1", "classic-v2"].includes(manifest.releaseVersion),
    `${environment}.releaseVersion is invalid`,
  );
  assert(
    ["not-deployed", "ready", "requires-redeploy"].includes(
      manifest.status,
    ),
    `${environment}.status is invalid`,
  );
  for (const field of [
    "platformFeeHookFactory",
    "boundedDynamicFeeHookFactory",
    "lockedPositionFeeForwarderFactory",
    "directLiquidityLauncher",
  ]) {
    const hasOptionalDeployment = manifest[field] !== null;
    assert(
      hasOptionalDeployment
        ? /^0x[a-fA-F0-9]{40}$/.test(manifest[field])
        : manifest[field] === null,
      `${environment}.${field} is invalid`,
    );
    assert(
      hasOptionalDeployment
        ? /^0x[a-fA-F0-9]{64}$/.test(
            manifest.runtimeCodeHashes[field],
          )
        : manifest.runtimeCodeHashes[field] === null,
      `${environment}.${field} code hash does not match status`,
    );
  }

  assert(
    [
      "not-deployed",
      "ready",
      "requires-redeploy",
      "lifecycle-pending",
    ].includes(
      manifest.memeLaunchStatus,
    ),
    `${environment}.memeLaunchStatus is invalid`,
  );
  const hasRecordedMemeDeployment =
    manifest.memeLaunchStatus === "ready" ||
    manifest.memeLaunchStatus === "requires-redeploy" ||
    manifest.memeLaunchStatus === "lifecycle-pending";
  for (const field of [
    "ethCreatorFeeHookFactory",
    "ethCreatorFeeHook",
    "memeLaunch",
  ]) {
    assert(
      hasRecordedMemeDeployment
        ? /^0x[a-fA-F0-9]{40}$/.test(manifest[field])
        : manifest[field] === null,
      `${environment}.${field} does not match Classic status`,
    );
    assert(
      hasRecordedMemeDeployment
        ? /^0x[a-fA-F0-9]{64}$/.test(manifest.runtimeCodeHashes[field])
        : manifest.runtimeCodeHashes[field] === null,
      `${environment}.${field} code hash does not match Classic status`,
    );
  }
}

assert(
  appDeployments.production.status === "ready",
  "The verified Mainnet V1 infrastructure must remain recorded",
);
assert(
  appDeployments.production.releaseVersion === "classic-v1" &&
    appDeployments.production.memeLaunchStatus ===
      "lifecycle-pending",
  "Mainnet Classic V1 must remain launch-disabled until the current lifecycle is verified",
);
assert(
  appDeployments.rehearsal.releaseVersion === "classic-v1" &&
    appDeployments.rehearsal.status === "ready",
  "Sepolia infrastructure is not marked ready",
);
assert(
  appDeployments.rehearsal.memeLaunchStatus === "ready",
  "Sepolia Classic is not enabled after the verified current lifecycle",
);
assert(
  appDeployments.rehearsal.deployer.toLowerCase() ===
    deployment.deployment.testWallet.toLowerCase(),
  "Sepolia deployer differs from the confirmed test wallet",
);
for (const field of [
  "platformFeeHookFactory",
  "boundedDynamicFeeHookFactory",
  "lockedPositionFeeForwarderFactory",
  "directLiquidityLauncher",
]) {
  assert(
    /^0x[a-fA-F0-9]{64}$/.test(
      appDeployments.rehearsal.deploymentTransactions[field],
    ),
    `rehearsal.${field} deployment transaction is invalid`,
  );
  assert(
    Number.isSafeInteger(
      appDeployments.rehearsal.deploymentBlocks[field],
    ) && appDeployments.rehearsal.deploymentBlocks[field] > 0,
    `rehearsal.${field} deployment block is invalid`,
  );
}
for (const field of [
  "ethCreatorFeeHookFactory",
  "ethCreatorFeeHook",
  "memeLaunch",
]) {
  assert(
    /^0x[a-fA-F0-9]{64}$/.test(
      appDeployments.rehearsal.deploymentTransactions[field],
    ),
    `rehearsal.${field} deployment transaction is invalid`,
  );
  assert(
    Number.isSafeInteger(
      appDeployments.rehearsal.deploymentBlocks[field],
    ) && appDeployments.rehearsal.deploymentBlocks[field] > 0,
    `rehearsal.${field} deployment block is invalid`,
  );
}
assert(
  appDeployments.rehearsal.sourceVerification.status === "verified",
  "Current Sepolia source verification is not recorded",
);
assert(
  appDeployments.rehearsal.sourceVerification.releaseEvidenceStatus ===
    "current-initial-buy-release",
  "Sepolia source verification is not bound to the atomic Dev Buy release",
);
assert(
  appDeployments.rehearsal.sourceVerification.explorer ===
    "https://eth-sepolia.blockscout.com",
  "Sepolia source verification uses an unexpected explorer",
);
for (const field of [
  "ethCreatorFeeHookFactory",
  "ethCreatorFeeHook",
  "memeLaunch",
]) {
  assert(
    appDeployments.rehearsal.sourceVerification
      .memeLaunchV1Contracts[field] === "verified",
    `Sepolia ${field} source verification is not recorded`,
  );
}
assert(
  appDeployments.rehearsal.sourceVerification.memeLaunchV1Contracts
    .launchedUerc20 === "verified",
  "Sepolia UERC20 source verification is not recorded",
);

const historicalLifecycleEvidence =
  appDeployments.rehearsal.historicalLifecycleEvidence;
assert(
  historicalLifecycleEvidence?.status ===
    "historical-invalid-metadata-abi" &&
    historicalLifecycleEvidence.releaseEligible === false &&
    historicalLifecycleEvidence.invalidReasonCode ===
      "uerc20-v2-extra-data-encoded-as-legacy-uint256" &&
    historicalLifecycleEvidence.independentRpcCount >= 2,
  "The stale Sepolia lifecycle must be retained only as invalid historical evidence",
);
for (const field of [
  "launch",
  "buy",
  "permit2Approval",
  "sell",
  "creatorClaim",
  "launcherClaim",
]) {
  assert(
    /^0x[a-fA-F0-9]{64}$/.test(
      historicalLifecycleEvidence.transactions[field],
    ),
    `Historical Sepolia lifecycle ${field} transaction is invalid`,
  );
  assert(
    Number.isSafeInteger(historicalLifecycleEvidence.blocks[field]) &&
      historicalLifecycleEvidence.blocks[field] > 0,
    `Historical Sepolia lifecycle ${field} block is invalid`,
  );
}
assert(
  /^0x[a-fA-F0-9]{40}$/.test(historicalLifecycleEvidence.token) &&
    /^0x[a-fA-F0-9]{64}$/.test(
      historicalLifecycleEvidence.poolId,
    ) &&
    /^0x[a-fA-F0-9]{64}$/.test(
      historicalLifecycleEvidence.launchHash,
    ) &&
    historicalLifecycleEvidence.initialTick === 204200 &&
    Number(historicalLifecycleEvidence.positionLiquidity) > 0 &&
    historicalLifecycleEvidence.creatorFeesClaimedWei !== "0" &&
    historicalLifecycleEvidence.launcherFeesClaimedWei !== "0",
  "Historical Sepolia lifecycle state evidence is incomplete",
);

const currentLifecycleEvidence =
  appDeployments.rehearsal.lifecycleEvidence;
assert(
  currentLifecycleEvidence?.status ===
      "verified-current-release" &&
    currentLifecycleEvidence.releaseEligible === true &&
    currentLifecycleEvidence.independentRpcCount >= 2 &&
    currentLifecycleEvidence.requiredMetadataAbi ===
      "UERC20Metadata(string description,string website,string image,bytes extraData)" &&
    currentLifecycleEvidence.requiredExtraData === "nonempty",
  "The current atomic Dev Buy Sepolia lifecycle is not release eligible",
);

const expectedCurrentLifecycleTransactions = {
  launch:
    "0xc608fb203c71525d4890f0849375340268cd878b3225013675b811d141b52b22",
  permit2Approval:
    "0x0d20141c3181d30ea8b3d121892681c6c7c99cbb5bd19824010d9d4be9ad8090",
  sell: "0xb850ccee7c279e2ffcd1610df91866a83b613c671a0d77de5a00f83973baa2a3",
  creatorClaim:
    "0xd0e027714c80d140200f14802c8530a294a99b7f3fe1a0c353198ea066843972",
  launcherClaim:
    "0x8a2c773af3c2eeeefc56059ede1a2d3069e9a16ba1da15ff73a76831e4da6b8f",
};
const expectedCurrentLifecycleBlocks = {
  launch: 11359239,
  permit2Approval: 11359247,
  sell: 11359251,
  creatorClaim: 11359256,
  launcherClaim: 11359261,
};
for (const field of Object.keys(expectedCurrentLifecycleTransactions)) {
  assert(
    currentLifecycleEvidence.transactions[field] ===
      expectedCurrentLifecycleTransactions[field],
    `Current Sepolia lifecycle ${field} transaction changed`,
  );
  assert(
    currentLifecycleEvidence.blocks[field] ===
      expectedCurrentLifecycleBlocks[field],
    `Current Sepolia lifecycle ${field} block changed`,
  );
}
assert(
  appDeployments.rehearsal.ethCreatorFeeHookFactory ===
    "0x630B8a1392601AE1d989323CC8051e8A17A0e5BF" &&
    appDeployments.rehearsal.ethCreatorFeeHook ===
      "0x13c34016c74bc43F4CBa97EDb48cC36b4bb620cc" &&
    appDeployments.rehearsal.memeLaunch ===
      "0x341edf9399C8c5dF361aec2939C4a17c2163a245" &&
    appDeployments.rehearsal.runtimeCodeHashes.memeLaunch ===
      "0x6e1fa1f21df7712433695c1ac584ed4c89b09ed11732cf62058dfc486639e3c2",
  "Current Sepolia deployment addresses or runtime hash changed",
);
assert(
  currentLifecycleEvidence.token ===
    "0x4D0fa6fb9eD708f5e71c53E77B261d8FBC8A018B" &&
    currentLifecycleEvidence.poolId ===
      "0x2305fce75dcc9b5107ef00ae76d9be0aa1c30829350452ae43599ff7c5da9c7d" &&
    currentLifecycleEvidence.launchHash ===
      "0xa9cd82a134a69275d0b5a9cc274da11dcfe0e0c2a4a7a2609a864adf84d1cb51" &&
    currentLifecycleEvidence.positionTokenId === "37832" &&
    currentLifecycleEvidence.initialTick === 204200 &&
    currentLifecycleEvidence.finalTick === 204199 &&
    currentLifecycleEvidence.positionLiquidity ===
      "36819258015569838458222" &&
    currentLifecycleEvidence.finalCreatorTokenBalance ===
      "30000000000000000000000" &&
    currentLifecycleEvidence.creatorFeesClaimedWei ===
      "10379961423422" &&
    currentLifecycleEvidence.launcherFeesClaimedWei ===
      "1153329047046" &&
    currentLifecycleEvidence.initialBuyNativeWei ===
      "600000000000000" &&
    currentLifecycleEvidence.initialBuyTokenAmount ===
      "437971781612384114831424" &&
    currentLifecycleEvidence.treasuryBalanceDeltaWei ===
      currentLifecycleEvidence.launcherFeesClaimedWei,
  "Current Sepolia lifecycle state evidence changed",
);
assert(
  currentLifecycleEvidence.metadata.extraData ===
    "0x7b2276223a312c2278223a22307850726f6772616d6d61626c65227d" &&
    currentLifecycleEvidence.metadata.decodedExtraData ===
      '{"v":1,"x":"0xProgrammable"}',
  "Current Sepolia lifecycle did not preserve nonempty UERC20 v2 metadata bytes",
);
assert(
  appDeployments.rehearsal.blocker === null,
  "Verified Sepolia Classic must not retain a release blocker",
);

console.log(
  `Validated ${catalog.variants.length} launch variants, ${protocolTestedIds.size} protocol-tested variants and ${behaviorIds.size} behavior modules`,
);
