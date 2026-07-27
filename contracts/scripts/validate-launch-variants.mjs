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
  "The verified Mainnet V2 infrastructure must remain recorded",
);
assert(
  appDeployments.production.releaseVersion === "classic-v2" &&
    appDeployments.production.memeLaunchStatus ===
      "lifecycle-pending",
  "Mainnet Classic V2 must remain launch-disabled until durable production operations are provisioned",
);
assert(
  appDeployments.production.ethCreatorFeeHookFactory ===
      "0xD405D8d88D7E4Dae4e1dAdce9A458234D9A5fd67" &&
    appDeployments.production.ethCreatorFeeHook ===
      "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC" &&
    appDeployments.production.memeLaunch ===
      "0xD240D06f8586eB799f20056054e5b527405E6bAd" &&
    appDeployments.production.runtimeCodeHashes
        .ethCreatorFeeHookFactory ===
      "0x8dd7205952dba3efad6f58a4b0193171c4ed825145319c908bc47dab1911c128" &&
    appDeployments.production.runtimeCodeHashes.ethCreatorFeeHook ===
      "0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381" &&
    appDeployments.production.runtimeCodeHashes.memeLaunch ===
      "0xd229555c79c61874549a1991c43df172104e1db3087ba8fca8804675b7440d36",
  "Current Mainnet Classic V2 addresses or runtime hashes changed",
);
for (const field of [
  "ethCreatorFeeHookFactory",
  "ethCreatorFeeHook",
  "memeLaunch",
]) {
  assert(
    /^0x[a-fA-F0-9]{64}$/.test(
      appDeployments.production.deploymentTransactions[field],
    ),
    `production.${field} deployment transaction is invalid`,
  );
  assert(
    Number.isSafeInteger(
      appDeployments.production.deploymentBlocks[field],
    ) && appDeployments.production.deploymentBlocks[field] > 0,
    `production.${field} deployment block is invalid`,
  );
  assert(
    appDeployments.production.sourceVerification.contracts[field] ===
      "match",
    `production.${field} source verification is not recorded`,
  );
}
assert(
  appDeployments.production.sourceVerification.status === "verified" &&
    appDeployments.production.sourceVerification.provider ===
      "Sourcify",
  "Current Mainnet V2 source verification is not recorded",
);
assert(
  appDeployments.production.lifecycleEvidence.status ===
      "verified-current-release" &&
    appDeployments.production.lifecycleEvidence.releaseEligible ===
      true &&
    appDeployments.production.lifecycleEvidence.requiredRelease ===
      "classic-v2" &&
    appDeployments.production.lifecycleEvidence.independentRpcCount >= 2 &&
    appDeployments.production.lifecycleEvidence.minimumInitialBuyWei ===
      "600000000000000" &&
    appDeployments.production.lifecycleEvidence.token ===
      "0x05204A4Ce651452892A620950BDc2ADeDBF63B0A" &&
    appDeployments.production.lifecycleEvidence.poolId ===
      "0xb12253d75eb143edcb6aab74f543802c6fa72998e092bc7bd1acf27a42adc2ea" &&
    appDeployments.production.lifecycleEvidence.positionRecipient ===
      "0x9020EeF40E36546Bf34f15070A8d9BCA2eBF4BB8" &&
    appDeployments.production.lifecycleEvidence.positionTokenId ===
      "351734" &&
    appDeployments.production.lifecycleEvidence.positionLiquidity ===
      "36819258015569838458222" &&
    appDeployments.production.lifecycleEvidence.finalCreatorTokenBalance ===
      "30000000000000000000000" &&
    appDeployments.production.lifecycleEvidence.creatorFeesClaimedWei ===
      "12170961423422" &&
    appDeployments.production.lifecycleEvidence.launcherFeesClaimedWei ===
      "1352329047046" &&
    appDeployments.production.lifecycleEvidence.treasuryBalanceDeltaWei ===
      "1352329047046",
  "Mainnet Classic V2 lifecycle gate is incoherent",
);
assert(
  appDeployments.production.lifecycleEvidence.transactions.launch ===
      "0x44a480caaac8b937e7ccc31e45e13bd725253e231fcc12f7795bc5358a0a5d4c" &&
    appDeployments.production.lifecycleEvidence.transactions.buy ===
      "0xbd416570fc9de744a53919a6c7e7ea9f849fe3f5e510a13376e6967c68145b48" &&
    appDeployments.production.lifecycleEvidence.transactions
        .permit2Approval ===
      "0xbca8b6d1e8eb3e8728680c879d213c412b042e7455a9edbc2d721c7f780e10f3" &&
    appDeployments.production.lifecycleEvidence.transactions.sell ===
      "0x4b461cccf14876cd9ecf05fcf0f295a6337079ceb3a3f4fb5b6fdddc6ada35c1" &&
    appDeployments.production.lifecycleEvidence.transactions.creatorClaim ===
      "0x16ba90a64df8ddc12b7be0ac8a0a664daf5008ad237ea7d3958a857f73624aff" &&
    appDeployments.production.lifecycleEvidence.transactions.launcherClaim ===
      "0x32a5de5591fb4c988b46c0d0a07095df1419634d10a158b3b6a36377bbe55fbe" &&
    appDeployments.production.lifecycleEvidence.blocks.launch === 25624511 &&
    appDeployments.production.lifecycleEvidence.blocks.buy === 25624526 &&
    appDeployments.production.lifecycleEvidence.blocks.permit2Approval ===
      25624545 &&
    appDeployments.production.lifecycleEvidence.blocks.sell === 25624553 &&
    appDeployments.production.lifecycleEvidence.blocks.creatorClaim ===
      25624575 &&
    appDeployments.production.lifecycleEvidence.blocks.launcherClaim ===
      25624580,
  "Mainnet Classic V2 lifecycle receipts changed",
);
assert(
  appDeployments.production.blocker ===
    "Public launch remains disabled pending named incident ownership and Privy production billing approval",
  "Verified Mainnet Classic V2 must retain the remaining operational blockers",
);
const historicalMainnetV1Deployment =
  appDeployments.production.historicalV1Deployment;
assert(
  historicalMainnetV1Deployment?.releaseVersion === "classic-v1" &&
    historicalMainnetV1Deployment.status ===
      "historical-mainnet-v1" &&
    historicalMainnetV1Deployment.ethCreatorFeeHookFactory ===
      "0xaE3C324B742a7576863A546120c4280b7c9E8448" &&
    historicalMainnetV1Deployment.ethCreatorFeeHook ===
      "0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc" &&
    historicalMainnetV1Deployment.memeLaunch ===
      "0x51d702731db281EE223904A4663E05BfCA26C775",
  "The verified Mainnet Classic V1 deployment must remain historical evidence",
);
assert(
  appDeployments.rehearsal.releaseVersion === "classic-v2" &&
    appDeployments.rehearsal.status === "ready" &&
    appDeployments.rehearsal.memeLaunchStatus ===
      "ready",
  "Sepolia Classic V2 must remain bound to the verified Test2 lifecycle",
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
  "Current Sepolia V2 source verification is not recorded",
);
assert(
  appDeployments.rehearsal.sourceVerification.releaseEvidenceStatus ===
    "current-classic-v2-lifecycle",
  "Sepolia source verification is not bound to the Classic V2 lifecycle",
);
assert(
  appDeployments.rehearsal.sourceVerification.explorer ===
    "https://repo.sourcify.dev" &&
    appDeployments.rehearsal.sourceVerification.secondaryExplorer ===
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
  "The Test2 UERC20 source verification is not recorded",
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

const historicalV1Deployment =
  appDeployments.rehearsal.historicalV1Deployment;
assert(
  historicalV1Deployment?.releaseVersion === "classic-v1" &&
    historicalV1Deployment.status ===
      "historical-current-initial-buy-release" &&
    historicalV1Deployment.ethCreatorFeeHookFactory ===
      "0x630B8a1392601AE1d989323CC8051e8A17A0e5BF" &&
    historicalV1Deployment.ethCreatorFeeHook ===
      "0x13c34016c74bc43F4CBa97EDb48cC36b4bb620cc" &&
    historicalV1Deployment.memeLaunch ===
      "0x341edf9399C8c5dF361aec2939C4a17c2163a245",
  "The verified Sepolia Classic V1 deployment must remain historical evidence",
);

const historicalV1LifecycleEvidence =
  appDeployments.rehearsal.historicalV1LifecycleEvidence;
assert(
  historicalV1LifecycleEvidence?.status ===
      "historical-classic-v1-verified" &&
    historicalV1LifecycleEvidence.releaseEligible === false &&
    historicalV1LifecycleEvidence.token ===
    "0x4D0fa6fb9eD708f5e71c53E77B261d8FBC8A018B" &&
    historicalV1LifecycleEvidence.poolId ===
      "0x2305fce75dcc9b5107ef00ae76d9be0aa1c30829350452ae43599ff7c5da9c7d" &&
    historicalV1LifecycleEvidence.launchHash ===
      "0xa9cd82a134a69275d0b5a9cc274da11dcfe0e0c2a4a7a2609a864adf84d1cb51" &&
    historicalV1LifecycleEvidence.transactions.launch ===
      "0xc608fb203c71525d4890f0849375340268cd878b3225013675b811d141b52b22" &&
    historicalV1LifecycleEvidence.transactions.launcherClaim ===
      "0x8a2c773af3c2eeeefc56059ede1a2d3069e9a16ba1da15ff73a76831e4da6b8f",
  "The verified Sepolia Classic V1 lifecycle must remain historical evidence",
);

const currentLifecycleEvidence =
  appDeployments.rehearsal.lifecycleEvidence;
assert(
  currentLifecycleEvidence?.status === "verified-current-release" &&
    currentLifecycleEvidence.releaseEligible === true &&
    currentLifecycleEvidence.requiredRelease === "classic-v2" &&
    currentLifecycleEvidence.sourceVerificationStatus ===
      "deployment-and-source-verified" &&
    currentLifecycleEvidence.independentRpcCount >= 2 &&
    currentLifecycleEvidence.minimumInitialBuyWei ===
      "600000000000000" &&
    currentLifecycleEvidence.requiredMetadataAbi ===
      "UERC20Metadata(string description,string website,string image,bytes extraData)" &&
    currentLifecycleEvidence.requiredExtraData === "nonempty",
  "The current Sepolia Classic V2 lifecycle evidence is incoherent",
);
assert(
  appDeployments.rehearsal.ethCreatorFeeHookFactory ===
    "0xb974A9EF7B75650428389b63fa6C4906450ABcE0" &&
    appDeployments.rehearsal.ethCreatorFeeHook ===
      "0x0c9De2721F537C311e05ad3671A17136C14a20Cc" &&
    appDeployments.rehearsal.memeLaunch ===
      "0x6Ae84F188468722d8b5970Bc3924C9C31b75FF4e" &&
    appDeployments.rehearsal.runtimeCodeHashes.ethCreatorFeeHookFactory ===
      "0x8dd7205952dba3efad6f58a4b0193171c4ed825145319c908bc47dab1911c128" &&
    appDeployments.rehearsal.runtimeCodeHashes.ethCreatorFeeHook ===
      "0xa1094bdd6c3bd1ba4d17d8f321f0e52a95a6247fae287aae90b008a7eacb05b7" &&
    appDeployments.rehearsal.runtimeCodeHashes.memeLaunch ===
      "0xf9977ba3a5c859d34beff333d129ae135190423a20e2a6ec5cb19588ff552e5f",
  "Current Sepolia Classic V2 addresses or runtime hashes changed",
);
assert(
  currentLifecycleEvidence.token ===
    "0x6f71A3CDa868d613552f8230790274BbEBB5d771" &&
    currentLifecycleEvidence.poolId ===
      "0x541eca58f02c9bee85cf4edbbc2ecfd8cbd6691c275b232f2f9b9c77ef8f82a6" &&
    currentLifecycleEvidence.launchHash ===
      "0x3d33fc925bdb72a7f4b4e3e71495dcd82575271f07361ef2db40b43f54b97fcc" &&
    currentLifecycleEvidence.positionRecipient ===
      "0xbdb2d2F49771Ec34d37DF9fADCBad058e96Db8DC" &&
    currentLifecycleEvidence.positionTokenId === "37835" &&
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
    currentLifecycleEvidence.treasuryBalanceDeltaWei ===
      currentLifecycleEvidence.launcherFeesClaimedWei,
  "Current Sepolia Classic V2 lifecycle state changed",
);
assert(
  currentLifecycleEvidence.transactions.launch ===
    "0xd15b074027a3516ce6ee65fab94df3a2ebbc5170ec7669f6420052a60b82c141" &&
    currentLifecycleEvidence.transactions.permit2Approval ===
      "0x32eff8ce7751eb811dcc94259c3867dd0d4e76c7617e9e6e1b62970bf73a9f41" &&
    currentLifecycleEvidence.transactions.sell ===
      "0x258278cb5662ab9d10966c9c48fe1849cff9e8162d73170f85471add0e7ff4d5" &&
    currentLifecycleEvidence.transactions.creatorClaim ===
      "0x0f3aebde7e6bff6b41e19b3e26d3705c637a0f99b6de07fc5e4644e7c1e2ed71" &&
    currentLifecycleEvidence.transactions.launcherClaim ===
      "0x57a58b6dd721d87430e51ad894da48d24bb0dc261bed8019e0fdf4f27b14a428" &&
    currentLifecycleEvidence.blocks.launch === 11361308 &&
    currentLifecycleEvidence.blocks.permit2Approval === 11361309 &&
    currentLifecycleEvidence.blocks.sell === 11361331 &&
    currentLifecycleEvidence.blocks.creatorClaim === 11361333 &&
    currentLifecycleEvidence.blocks.launcherClaim === 11361341,
  "Current Sepolia Classic V2 lifecycle receipts changed",
);
assert(
  appDeployments.rehearsal.blocker === null,
  "Verified Sepolia Classic V2 must not retain the Test2 blocker",
);

console.log(
  `Validated ${catalog.variants.length} launch variants, ${protocolTestedIds.size} protocol-tested variants and ${behaviorIds.size} behavior modules`,
);
