const SITE_ORIGIN = "https://programmable.market";
const INITIAL_BUY_QUOTE_PATH = "/v4/chains/4663/initial-buy-quote";
const SUCCESSOR_POLICY_STATEMENT = "Robinhood V4.1 requires a request-bound funding plan, an atomic initial buy meeting a $1 gross native ETH reference at permit authorization, and an exact server-verified native fee kernel. The kernel policy is 20 bps on the gross native leg once per successful swap, paid through native ETH claims to the fixed treasury. Per-launch fee and initial-buy receipts bind the exact prepared code and stamped pool. Source admission does not prove deployed vault state, a completed trade, collected revenue or third-party indexing. Require live publicWrites, publicAuthorization and releaseReady discovery before creating; the wallet signature remains separate.";
const LEGACY_POLICY_STATEMENTS = [
  "Its required 20 bps default policy is not a canonical onchain fee-enforcement or revenue claim.",
  "The required default policy for new Robinhood V4 API Custom launches is 20 bps to the published recipient. It is policy configuration, not proof of canonical onchain fee enforcement, a charged fee or platform revenue, and missing onchain fee enforcement is not itself a write blocker.",
  "The required 20 bps default configuration is not a canonical onchain fee-enforcement, charged-fee or revenue claim, and missing onchain fee enforcement is not itself a write blocker.",
  "Robinhood V4 targets public self-serve after its non-fee release predicates are deployed; require live discovery fields before create. Its 20 bps recipient configuration is required policy but not guaranteed canonical onchain enforcement.",
] as const;

/** Activation chooses the version elsewhere. This projection cannot grant readiness or public writes. */
export function robinhoodV4PublicContractDiscovery(profileVersion: string) {
  if (profileVersion !== "4.1.0") return {};
  return {
    profileVersion: "4.1.0",
    cliVersion: "4.1.0",
    openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v4.1.json`,
    packConfigSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/pack-config.json`,
    sourceVerificationSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/source-verification-status.json`,
    createRequestSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/create-request.json`,
    guideUrl: `${SITE_ORIGIN}/docs/developers.md`,
    admissionDescriptorUrl: "https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.1.json",
    advertisedFundingModes: ["wallet-transaction-value"],
    initialBuyQuotePath: INITIAL_BUY_QUOTE_PATH,
    fundingPlan: {
      required: true,
      schemaVersion: "programmable.robinhood-funding-plan.v1",
      schemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/funding-plan.json`,
      capitalSourceChoices: ["buyer-funded", "creator-funded", "hybrid", "custom"],
      pricingModelChoices: ["concentrated-liquidity", "custom-curve", "auction", "custom"],
      allocationFields: ["initialLiquidityWei", "initialBuyWei", "reserveWei", "otherLaunchValueWei"],
      allocationSum: "equals-funding.valueWei-without-double-counting",
      budgets: ["maxLaunchValueWei", "maxGasCostWei"],
      gasAdditionalToLaunchValue: true,
      buildOnlyCreatesPermits: false,
      declarationsProveLiquidityOrSolvency: false,
    },
    initialBuy: {
      required: true,
      minimumUsd: "1",
      assessmentTime: "permit-authorization",
      assessmentBase: "gross-native-initial-buy-at-admission",
      feeTreatment: "included-in-initial-buy",
      gasTreatment: "additional-not-included-in-initial-buy",
      execution: "atomic-full-native-input-and-minimum-token-output",
      recipient: "launch-wallet",
      minimumTokensOutRequired: true,
      quotePath: INITIAL_BUY_QUOTE_PATH,
      quoteAuthentication: "none",
      quoteSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/initial-buy-quote.json`,
      reviewSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4.1/initial-buy-review.json`,
      referenceChainId: 1,
      executionChainId: 4663,
      referenceFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      referenceDecimals: 8,
      maximumQuoteAgeSeconds: 60,
      staleFallback: false,
      walletExecutionUsdValueGuaranteed: false,
      firstTradeIndexingGuaranteed: false,
      budgetIncreaseWithoutUserApproval: false,
    },
    platformFeePolicyStatus: "required-exact-native-fee-kernel",
    platformFeePolicy: {
      required: true,
      status: "required-exact-native-fee-kernel",
      appliesTo: "new-robinhood-v4.1-api-custom-launches-only",
      changesExistingLaunches: false,
      changesEthereumLaunches: false,
      rateBps: 20,
      ratePpm: 2_000,
      ratePercent: "0.20%",
      recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
      basis: "gross-native-leg-once-per-successful-swap",
      feeCurrency: "native-ETH",
      accountingMode: "pool-manager-native-claims",
      rounding: "ceil-per-trade",
      accrual: "pool-manager-native-claims",
      claimMechanism: "permissionless-fixed-recipient",
      enforcement: "exact-kernel-proof-required-before-wallet-handoff",
      claimScope: "exact-verified-kernel-and-stamped-poolkey-only",
      separateFromCreatorAndLpFees: true,
      childRuntimeObservation: "required-after-deployment",
      transfersToTreasuryImmediatelyPerTrade: false,
      canonicalOnchainEnforcementProven: false,
      guaranteedRevenue: false,
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
    },
    nativeFeeClaiming: {
      mechanism: "permissionless-fixed-recipient",
      scope: "exact-native-fee-vault-only",
      requiresPostDeploymentVaultVerification: true,
      apiKeyScopeGranted: false,
      transactionBroadcastByApi: false,
    },
  } as const;
}

/** Replace only the version-specific Robinhood fee clauses; every historical and Ethereum clause remains unchanged. */
export function robinhoodV4PublicPolicyDescription(profileVersion: string, legacyDescription: string): string {
  if (profileVersion !== "4.1.0") return legacyDescription;
  return LEGACY_POLICY_STATEMENTS.reduce((description, statement) =>
    description.replace(statement, SUCCESSOR_POLICY_STATEMENT), legacyDescription);
}

/** Shared agent and documentation guidance; this never grants release or wallet authority. */
export function robinhoodV4PublicLaunchRequirements(profileVersion: string): readonly string[] {
  const contract = robinhoodV4PublicContractDiscovery(profileVersion);
  if (contract.profileVersion !== "4.1.0") return [];
  return [
    `Robinhood ${profileVersion} requires a fundingPlan before a funded launch: choose buyer-funded, creator-funded, hybrid or custom capital and the pricing model; declare initial liquidity, initial buy, reserve and other launch value separately. Their sum must equal the native wallet transaction value. Confirm maxLaunchValueWei and maxGasCostWei with the user; gas is additional. A build-only plan cannot obtain a permit. Funding declarations do not prove liquidity or solvency. Funding-plan schema: ${contract.fundingPlan.schemaUrl}.`,
    `Every funded Robinhood launch requires an atomic initial buy of at least USD ${contract.initialBuy.minimumUsd} at permit authorization. Read https://api.programmable.market${contract.initialBuyQuotePath} without an API key before building, confirm the native buy amount and positive minimum token output to the launch wallet, and count the buy once inside total transaction value. The server independently obtains a fresh quote, no older than ${contract.initialBuy.maximumQuoteAgeSeconds} seconds, without stale fallback. Never increase the amount or budget without user approval. The reference feed is on Ethereum (chain 1); execution remains on Robinhood (chain 4663). The quoted dollar value at wallet execution and third-party indexing are not guaranteed.`,
    `Robinhood ${profileVersion} requires an exact server-verified native fee kernel for the stamped PoolKey. The platform receives ${contract.platformFeePolicy.rateBps} bps (${contract.platformFeePolicy.ratePercent}) of the gross native ETH leg once per successful swap, separately from creator and LP fees, rounded up per trade. Fees accrue as PoolManager native claims for ${contract.platformFeePolicy.recipient}; a permissionless claim pays only that fixed recipient. Admission is not proof of deployed vault state, completed trades or collected revenue. The API key never signs, broadcasts or claims fees.`,
  ];
}
