import "server-only";

import type { DualRpcCandidateEvidence } from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import { PROJECTOR_EVENT_SIGNATURES } from "./event-manifest";
import { getDataPipelineReleaseBinding } from "./release-binding.server";

type HexAddress = `0x${string}`;
type HexBytes32 = `0x${string}`;
type HexData = `0x${string}`;
type ProjectorModel = "classic" | "stock-paired";
type ProjectorRelease =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";
type SourceRole =
  | "launcher"
  | "hook"
  | "vault_factory"
  | "vesting_factory"
  | "coordinator"
  | "reward_vault";

type CanonicalValue =
  | null
  | boolean
  | string
  | readonly string[];

type FieldType =
  | "address"
  | "bytes32"
  | "bool"
  | "uint8"
  | "uint16"
  | "uint24"
  | "uint64"
  | "uint256"
  | "int24"
  | "address[]"
  | "uint16[]";

export type ProjectorFactKind =
  | "launch"
  | "liquidity"
  | "initial-buy"
  | "initial-buy-custody"
  | "pool-registration"
  | "fee-disclosure"
  | "fee-accrual"
  | "creator-hook-claim"
  | "launcher-hook-claim"
  | "reward-vault-deployment"
  | "vesting-wallet-deployment"
  | "creator-fee-checkpoint"
  | "beneficiary-claim"
  | "payout-change"
  | "reward-configuration-activation"
  | "eth-launch-coordinator";

export type ProjectorProcedure =
  | "stage_launch_projection"
  | "stage_launch_position_liquidity_v1"
  | "stage_initial_buy_custody_projection"
  | "stage_pool_projection"
  | "stage_pool_fee_configuration"
  | "stage_pool_fee_configuration_v2"
  | "stage_fee_accrual_fact"
  | "append_creator_hook_claim_fact"
  | "append_launcher_hook_claim_fact"
  | "append_creator_fee_checkpoint_fact"
  | "stage_claim_projection"
  | "stage_payout_change_projection"
  | "append_reward_configuration_activation_fact"
  | null;

type EventSpec = Readonly<{
  sourceRole: SourceRole;
  kind: ProjectorFactKind;
  procedure: ProjectorProcedure;
  fields: Readonly<Record<string, FieldType>>;
}>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = (1n << 256n) - 1n;
const MIN_TICK = -887_272n;
const MAX_TICK = 887_272n;
const RELEASE_BINDING = getDataPipelineReleaseBinding();

const F = Object.freeze({
  address: "address" as const,
  bytes32: "bytes32" as const,
  bool: "bool" as const,
  uint8: "uint8" as const,
  uint16: "uint16" as const,
  uint24: "uint24" as const,
  uint64: "uint64" as const,
  uint256: "uint256" as const,
  int24: "int24" as const,
  addresses: "address[]" as const,
  uint16s: "uint16[]" as const,
});

function spec(
  sourceRole: SourceRole,
  kind: ProjectorFactKind,
  procedure: ProjectorProcedure,
  fields: Record<string, FieldType>,
): EventSpec {
  return Object.freeze({
    sourceRole,
    kind,
    procedure,
    fields: Object.freeze(fields),
  });
}

const nativeLauncherClaim = {
  treasury: F.address,
  recipient: F.address,
  caller: F.address,
  amount: F.uint256,
};
const stockLauncherClaim = {
  treasury: F.address,
  recipient: F.address,
  quoteAsset: F.address,
  caller: F.address,
  amount: F.uint256,
};
const stockLaunch = {
  deployer: F.address,
  token: F.address,
  quoteAsset: F.address,
  poolId: F.bytes32,
  rewardVault: F.address,
  positionRecipient: F.address,
  positionTokenId: F.uint256,
  launchHash: F.bytes32,
};
const stockLiquidity = {
  token: F.address,
  quoteAsset: F.address,
  totalSupply: F.uint256,
  tokenLiquidityAmount: F.uint256,
  lockedTokenDust: F.uint256,
  initialTick: F.int24,
  tickLower: F.int24,
  tickUpper: F.int24,
  lpFeePips: F.uint24,
  launchHash: F.bytes32,
};
const stockInitialBuy = {
  deployer: F.address,
  token: F.address,
  quoteAsset: F.address,
  poolId: F.bytes32,
  quoteAmount: F.uint256,
  tokenAmount: F.uint256,
  launchHash: F.bytes32,
};
const stockCoordinator = {
  creator: F.address,
  token: F.address,
  quoteAsset: F.address,
  initialBuyEthAmount: F.uint256,
  initialBuyQuoteAmount: F.uint256,
  initialBuyTokenAmount: F.uint256,
  launchHash: F.bytes32,
};
const stockPoolRegistered = {
  poolId: F.bytes32,
  token: F.address,
  quoteAsset: F.address,
  rewardVault: F.address,
  registrar: F.address,
  quoteIsCurrency0: F.bool,
  rewardConfigurationHash: F.bytes32,
  quoteConfigurationHash: F.bytes32,
};
const stockFeeDisclosure = {
  poolId: F.bytes32,
  token: F.address,
  quoteAsset: F.address,
  rewardVault: F.address,
  buySwapFeeBps: F.uint16,
  sellSwapFeeBps: F.uint16,
  creatorFeeBps: F.uint16,
  launcherFeeBps: F.uint16,
  transferTaxBps: F.uint16,
  lpFeePips: F.uint24,
};
const stockFeeAccrual = {
  poolId: F.bytes32,
  swapSender: F.address,
  quoteAsset: F.address,
  isBuy: F.bool,
  grossQuoteAmount: F.uint256,
  creatorFee: F.uint256,
  launcherFee: F.uint256,
};
const stockCreatorClaim = {
  poolId: F.bytes32,
  rewardVault: F.address,
  quoteAsset: F.address,
  caller: F.address,
  amount: F.uint256,
};
const stockVaultClaim = {
  beneficiary: F.address,
  payoutAddress: F.address,
  quoteAsset: F.address,
  amount: F.uint256,
  beneficiaryTotalClaimed: F.uint256,
  vaultTotalReceived: F.uint256,
};
const stockVaultPayout = {
  beneficiary: F.address,
  previousPayoutAddress: F.address,
  newPayoutAddress: F.address,
};

const EVENT_SPECS: Readonly<Record<string, Readonly<Record<string, EventSpec>>>> =
  Object.freeze({
    ClassicV2Launcher: Object.freeze({
      MemeTokenLaunched: spec("launcher", "launch", "stage_launch_projection", {
        creator: F.address,
        token: F.address,
        poolId: F.bytes32,
        feeHook: F.address,
        positionRecipient: F.address,
        positionTokenId: F.uint256,
        totalSwapFeeBps: F.uint16,
        launchHash: F.bytes32,
      }),
      MemeLiquidityConfigured: spec(
        "launcher",
        "liquidity",
        "stage_launch_position_liquidity_v1",
        {
          token: F.address,
          totalSupply: F.uint256,
          tokenLiquidityAmount: F.uint256,
          lockedTokenDust: F.uint256,
          initialTick: F.int24,
          tickLower: F.int24,
          tickUpper: F.int24,
          lpFeePips: F.uint24,
          launchHash: F.bytes32,
        },
      ),
      MemeCreatorInitialBuy: spec("launcher", "initial-buy", null, {
        creator: F.address,
        token: F.address,
        poolId: F.bytes32,
        nativeAmount: F.uint256,
        tokenAmount: F.uint256,
        launchHash: F.bytes32,
      }),
    }),
    ClassicV2Hook: Object.freeze({
      PoolRegistered: spec("hook", "pool-registration", "stage_pool_projection", {
        poolId: F.bytes32,
        token: F.address,
        creator: F.address,
        registrar: F.address,
        totalSwapFeeBps: F.uint16,
      }),
      PoolFeeDisclosure: spec(
        "hook",
        "fee-disclosure",
        "stage_pool_fee_configuration",
        {
          poolId: F.bytes32,
          token: F.address,
          buySwapFeeBps: F.uint16,
          sellSwapFeeBps: F.uint16,
          launcherFeeBps: F.uint16,
          transferTaxBps: F.uint16,
          lpFeePips: F.uint24,
        },
      ),
      NativeSwapFeesAccrued: spec("hook", "fee-accrual", "stage_fee_accrual_fact", {
        poolId: F.bytes32,
        swapSender: F.address,
        grossNativeAmount: F.uint256,
        creatorFee: F.uint256,
        launcherFee: F.uint256,
      }),
      CreatorFeesClaimed: spec(
        "hook",
        "creator-hook-claim",
        "append_creator_hook_claim_fact",
        {
          poolId: F.bytes32,
          creator: F.address,
          recipient: F.address,
          caller: F.address,
          amount: F.uint256,
        },
      ),
      LauncherFeesClaimed: spec(
        "hook",
        "launcher-hook-claim",
        "append_launcher_hook_claim_fact",
        nativeLauncherClaim,
      ),
    }),
    ClassicV3Launcher: Object.freeze({
      MemeTokenLaunchedV2: spec("launcher", "launch", "stage_launch_projection", {
        deployer: F.address,
        token: F.address,
        poolId: F.bytes32,
        feeHook: F.address,
        rewardVault: F.address,
        positionRecipient: F.address,
        positionTokenId: F.uint256,
        buySwapFeeBps: F.uint16,
        sellSwapFeeBps: F.uint16,
        rewardConfigurationHash: F.bytes32,
        launchHash: F.bytes32,
      }),
      MemeLiquidityConfiguredV2: spec(
        "launcher",
        "liquidity",
        "stage_launch_position_liquidity_v1",
        {
          token: F.address,
          totalSupply: F.uint256,
          tokenLiquidityAmount: F.uint256,
          lockedTokenDust: F.uint256,
          initialTick: F.int24,
          tickLower: F.int24,
          tickUpper: F.int24,
          lpFeePips: F.uint24,
          launchHash: F.bytes32,
        },
      ),
      MemeCreatorInitialBuyV2: spec("launcher", "initial-buy", null, {
        deployer: F.address,
        token: F.address,
        poolId: F.bytes32,
        nativeAmount: F.uint256,
        tokenAmount: F.uint256,
        launchHash: F.bytes32,
      }),
      MemeCreatorInitialBuyCustodyV2: spec(
        "launcher",
        "initial-buy-custody",
        "stage_initial_buy_custody_projection",
        {
          deployer: F.address,
          token: F.address,
          custody: F.address,
          mode: F.uint8,
          durationDays: F.uint16,
          cliffDays: F.uint16,
          configurationHash: F.bytes32,
          launchHash: F.bytes32,
        },
      ),
    }),
    ClassicV3Hook: Object.freeze({
      PoolRegistered: spec("hook", "pool-registration", "stage_pool_projection", {
        poolId: F.bytes32,
        token: F.address,
        rewardVault: F.address,
        registrar: F.address,
        buySwapFeeBps: F.uint16,
        sellSwapFeeBps: F.uint16,
        rewardConfigurationHash: F.bytes32,
      }),
      PoolFeeDisclosure: spec(
        "hook",
        "fee-disclosure",
        "stage_pool_fee_configuration_v2",
        {
          poolId: F.bytes32,
          token: F.address,
          rewardVault: F.address,
          buySwapFeeBps: F.uint16,
          sellSwapFeeBps: F.uint16,
          buyCreatorFeeBps: F.uint16,
          sellCreatorFeeBps: F.uint16,
          launcherFeeBps: F.uint16,
          transferTaxBps: F.uint16,
          lpFeePips: F.uint24,
        },
      ),
      NativeSwapFeesAccrued: spec("hook", "fee-accrual", "stage_fee_accrual_fact", {
        poolId: F.bytes32,
        swapSender: F.address,
        isBuy: F.bool,
        appliedTotalSwapFeeBps: F.uint16,
        grossNativeAmount: F.uint256,
        creatorFee: F.uint256,
        launcherFee: F.uint256,
      }),
      CreatorFeesClaimed: spec(
        "hook",
        "creator-hook-claim",
        "append_creator_hook_claim_fact",
        {
          poolId: F.bytes32,
          rewardVault: F.address,
          caller: F.address,
          amount: F.uint256,
        },
      ),
      LauncherFeesClaimed: spec(
        "hook",
        "launcher-hook-claim",
        "append_launcher_hook_claim_fact",
        nativeLauncherClaim,
      ),
    }),
    ClassicV3RewardVaultFactory: Object.freeze({
      ClassicRewardVaultDeployed: spec(
        "vault_factory",
        "reward-vault-deployment",
        null,
        {
          vault: F.address,
          poolId: F.bytes32,
          feeHook: F.address,
          salt: F.bytes32,
          configurationHash: F.bytes32,
        },
      ),
    }),
    ClassicV3VestingWalletFactory: Object.freeze({
      ClassicInitialBuyVestingWalletDeployed: spec(
        "vesting_factory",
        "vesting-wallet-deployment",
        null,
        {
          wallet: F.address,
          token: F.address,
          beneficiary: F.address,
          salt: F.bytes32,
          configurationHash: F.bytes32,
        },
      ),
    }),
    ClassicV3RewardVault: Object.freeze({
      CreatorFeesCheckpointed: spec(
        "reward_vault",
        "creator-fee-checkpoint",
        "append_creator_fee_checkpoint_fact",
        {
          poolId: F.bytes32,
          configurationEpoch: F.uint64,
          amount: F.uint256,
          totalCreatorFeesReceived: F.uint256,
        },
      ),
      BeneficiaryFeesClaimed: spec(
        "reward_vault",
        "beneficiary-claim",
        "stage_claim_projection",
        {
          beneficiary: F.address,
          amount: F.uint256,
          beneficiaryTotalClaimed: F.uint256,
          vaultTotalReceived: F.uint256,
        },
      ),
      PayoutWalletChanged: spec(
        "reward_vault",
        "payout-change",
        "stage_payout_change_projection",
        {
          poolId: F.bytes32,
          allocationIndex: F.uint256,
          previousPayoutWallet: F.address,
          newPayoutWallet: F.address,
          shareBps: F.uint16,
          configurationEpoch: F.uint64,
          activeConfigurationHash: F.bytes32,
          effectiveTotalCreatorFeesReceived: F.uint256,
        },
      ),
      CtoRewardConfigurationActivated: spec(
        "reward_vault",
        "reward-configuration-activation",
        "append_reward_configuration_activation_fact",
        {
          poolId: F.bytes32,
          approvalReference: F.bytes32,
          configurationEpoch: F.uint64,
          previousConfigurationHash: F.bytes32,
          newConfigurationHash: F.bytes32,
          beneficiaries: F.addresses,
          sharesBps: F.uint16s,
          effectiveTotalCreatorFeesReceived: F.uint256,
        },
      ),
    }),
    StockV1Launcher: stockLauncherSpec(),
    StockV2Launcher: stockLauncherSpec(),
    StockV3Launcher: stockLauncherSpec(),
    StockV1EthCoordinator: stockCoordinatorSpec(),
    StockV2EthCoordinator: stockCoordinatorSpec(),
    StockV3EthCoordinator: stockCoordinatorSpec(),
    StockV1Hook: stockHookSpec(),
    StockV2V3Hook: stockHookSpec(),
    StockV1RewardVaultFactory: stockFactorySpec(),
    StockV2V3RewardVaultFactory: stockFactorySpec(),
    StockV1RewardVault: stockVaultSpec(),
    StockV2V3RewardVault: stockVaultSpec(),
  });

function stockLauncherSpec(): Readonly<Record<string, EventSpec>> {
  return Object.freeze({
    StockPairedTokenLaunched: spec("launcher", "launch", "stage_launch_projection", stockLaunch),
    StockPairedLiquidityConfigured: spec(
      "launcher",
      "liquidity",
      "stage_launch_position_liquidity_v1",
      stockLiquidity,
    ),
    StockPairedCreatorInitialBuy: spec("launcher", "initial-buy", null, stockInitialBuy),
  });
}

function stockCoordinatorSpec(): Readonly<Record<string, EventSpec>> {
  return Object.freeze({
    StockPairedEthTokenLaunched: spec(
      "coordinator",
      "eth-launch-coordinator",
      null,
      stockCoordinator,
    ),
  });
}

function stockHookSpec(): Readonly<Record<string, EventSpec>> {
  return Object.freeze({
    PoolRegistered: spec("hook", "pool-registration", "stage_pool_projection", stockPoolRegistered),
    PoolFeeDisclosure: spec(
      "hook",
      "fee-disclosure",
      "stage_pool_fee_configuration",
      stockFeeDisclosure,
    ),
    QuoteSwapFeesAccrued: spec("hook", "fee-accrual", "stage_fee_accrual_fact", stockFeeAccrual),
    CreatorFeesClaimed: spec(
      "hook",
      "creator-hook-claim",
      "append_creator_hook_claim_fact",
      stockCreatorClaim,
    ),
    LauncherFeesClaimed: spec(
      "hook",
      "launcher-hook-claim",
      "append_launcher_hook_claim_fact",
      stockLauncherClaim,
    ),
  });
}

function stockFactorySpec(): Readonly<Record<string, EventSpec>> {
  return Object.freeze({
    QuoteAssetFeeSplitVaultDeployed: spec(
      "vault_factory",
      "reward-vault-deployment",
      null,
      {
        vault: F.address,
        feeHook: F.address,
        poolId: F.bytes32,
        quoteAsset: F.address,
      },
    ),
  });
}

function stockVaultSpec(): Readonly<Record<string, EventSpec>> {
  return Object.freeze({
    PayoutAddressUpdated: spec(
      "reward_vault",
      "payout-change",
      "stage_payout_change_projection",
      stockVaultPayout,
    ),
    BeneficiaryFeesClaimed: spec(
      "reward_vault",
      "beneficiary-claim",
      "stage_claim_projection",
      stockVaultClaim,
    ),
  });
}

function fail(reason: string): never {
  throw new TypeError(`Projector fold rejected ${reason}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const sortedExpected = [...expected].sort((a, b) => a.localeCompare(b));
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalUnsigned(value: unknown, bits: number): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return fail("non-canonical unsigned payload value");
  }
  const integer = BigInt(value);
  const maximum = bits === 256 ? MAX_UINT256 : (1n << BigInt(bits)) - 1n;
  if (integer > maximum) return fail("out-of-range unsigned payload value");
  return value;
}

function canonicalSigned(value: unknown, bits: number): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*|-[1-9]\d*)$/u.test(value)) {
    return fail("non-canonical signed payload value");
  }
  const integer = BigInt(value);
  const boundary = 1n << BigInt(bits - 1);
  if (integer < -boundary || integer >= boundary) {
    return fail("out-of-range signed payload value");
  }
  return value;
}

function canonicalHex(value: unknown, bytes: number): string {
  const pattern = new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "u");
  if (typeof value !== "string" || !pattern.test(value)) {
    return fail("non-canonical hexadecimal payload value");
  }
  return value;
}

function canonicalValue(type: FieldType, value: unknown): CanonicalValue {
  switch (type) {
    case "address":
      return canonicalHex(value, 20);
    case "bytes32":
      return canonicalHex(value, 32);
    case "bool":
      if (typeof value !== "boolean") return fail("non-boolean payload value");
      return value;
    case "uint8":
      return canonicalUnsigned(value, 8);
    case "uint16":
      return canonicalUnsigned(value, 16);
    case "uint24":
      return canonicalUnsigned(value, 24);
    case "uint64":
      return canonicalUnsigned(value, 64);
    case "uint256":
      return canonicalUnsigned(value, 256);
    case "int24":
      return canonicalSigned(value, 24);
    case "address[]":
    case "uint16[]": {
      if (!Array.isArray(value)) return fail("non-array payload value");
      return Object.freeze(
        value.map((item) =>
          type === "address[]"
            ? canonicalHex(item, 20)
            : canonicalUnsigned(item, 16),
        ),
      );
    }
  }
}

function canonicalPayload(
  input: unknown,
  fields: Readonly<Record<string, FieldType>>,
): Readonly<Record<string, CanonicalValue>> {
  if (!isPlainRecord(input) || !exactKeys(input, Object.keys(fields))) {
    return fail("payload fields");
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(fields)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, type]) => [name, canonicalValue(type, input[name])]),
    ),
  );
}

function canonicalAddress(value: string): HexAddress {
  return canonicalHex(value, 20) as HexAddress;
}

function canonicalBytes32(value: string): HexBytes32 {
  return canonicalHex(value, 32) as HexBytes32;
}

function canonicalData(value: string): HexData {
  if (!/^0x(?:[0-9a-f]{2})*$/u.test(value)) return fail("raw data");
  return value as HexData;
}

function exactRelease(
  event: ProjectorFoldEvent,
): { model: ProjectorModel; releaseVersion: ProjectorRelease } {
  const selectedModel = event.releaseContext?.model ?? event.evidence.model;
  const selectedRelease =
    event.releaseContext?.releaseVersion ?? event.evidence.releaseVersion;
  if (
    (selectedModel !== "classic" && selectedModel !== "stock-paired") ||
    ![
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ].includes(selectedRelease)
  ) {
    return fail("unresolved release evidence");
  }
  if (
    event.releaseContext &&
    ((event.evidence.model !== "unresolved" &&
      event.evidence.model !== event.releaseContext.model) ||
      (event.evidence.releaseVersion !== "unresolved" &&
        event.evidence.releaseVersion !== event.releaseContext.releaseVersion) ||
      (event.candidate.releaseHint.model !== "unresolved" &&
        event.candidate.releaseHint.model !== event.releaseContext.model) ||
      (event.candidate.releaseHint.releaseVersion !== "unresolved" &&
        event.candidate.releaseHint.releaseVersion !==
          event.releaseContext.releaseVersion))
  ) {
    return fail("release context conflicts with provider evidence");
  }
  const release = RELEASE_BINDING.releases.find(
    (item) => item.model === selectedModel && item.releaseVersion === selectedRelease,
  );
  if (
    !release ||
    BigInt(event.candidate.blockNumber) < BigInt(release.activationBlock) ||
    (![...release.sourceContracts, ...release.dynamicContracts].includes(
      event.candidate.contractName,
    ))
  ) {
    return fail("release binding");
  }
  return {
    model: selectedModel,
    releaseVersion: selectedRelease as ProjectorRelease,
  };
}

export type ProjectorFoldEvent = Readonly<{
  candidate: EnvioCandidate;
  evidence: DualRpcCandidateEvidence;
  releaseContext?: Readonly<{
    model: ProjectorModel;
    releaseVersion: ProjectorRelease;
  }>;
}>;

export type ProjectorOccurrenceFact = Readonly<{
  candidateId: string;
  chainId: "1";
  releaseId: ProjectorRelease;
  modelId: ProjectorModel;
  sourceGroup: "core";
  blockNumber: string;
  blockHash: HexBytes32;
  blockTimestamp: string;
  transactionHash: HexBytes32;
  transactionIndex: string;
  receiptLogOrdinal: string;
  blockGlobalLogIndex: string;
  sourceAddress: HexAddress;
  eventSignature: HexBytes32;
  eventType: string;
  orderedTopics: readonly HexBytes32[];
  rawData: HexData;
  decodedPayload: Readonly<Record<string, CanonicalValue>>;
  payloadHash: HexBytes32;
  dynamicSourceAttestationId: string | null;
}>;

export type ProjectorEventFact = Readonly<{
  sourceCandidateId: string;
  sourceRole: SourceRole;
  kind: ProjectorFactKind;
  procedure: ProjectorProcedure;
  values: Readonly<Record<string, CanonicalValue>>;
}>;

function assertEvidence(input: ProjectorFoldEvent) {
  const { candidate, evidence } = input;
  if (
    evidence.chainId !== 1 ||
    evidence.candidateId !== candidate.candidateId ||
    evidence.sourceAddress !== candidate.sourceAddress ||
    evidence.contractName !== candidate.contractName ||
    evidence.eventName !== candidate.eventName ||
    evidence.payloadHash !== candidate.payloadHash ||
    evidence.candidateBlockNumber !== candidate.blockNumber ||
    evidence.candidateBlockHash !== candidate.blockHash ||
    evidence.candidateBlockTimestamp !== candidate.blockTimestamp ||
    evidence.transactionHash !== candidate.transactionHash ||
    evidence.transactionIndex !== candidate.transactionIndex ||
    !Number.isSafeInteger(evidence.receiptLogOrdinal) ||
    evidence.receiptLogOrdinal < 0 ||
    evidence.receiptLogOrdinal > 0xffff_ffff
  ) {
    return fail("dual-RPC evidence mismatch");
  }
  const dynamic = EVENT_SPECS[candidate.contractName]?.[candidate.eventName]
    ?.sourceRole === "reward_vault";
  if (
    dynamic &&
    (evidence.sourceKind !== "dynamic-attested" ||
      typeof evidence.dynamicSourceAttestationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        evidence.dynamicSourceAttestationId,
      ))
  ) {
    return fail("dynamic source attestation");
  }
  if (!dynamic && evidence.sourceKind !== "static") {
    return fail("static source evidence");
  }
}

export function translateProjectorEvent(input: ProjectorFoldEvent): Readonly<{
  occurrence: ProjectorOccurrenceFact;
  fact: ProjectorEventFact;
}> {
  assertEvidence(input);
  const { candidate, evidence } = input;
  const eventSpec = EVENT_SPECS[candidate.contractName]?.[candidate.eventName];
  if (!eventSpec) return fail("event outside frozen manifest");
  const release = exactRelease(input);
  const decodedPayload = canonicalPayload(candidate.decodedPayload, eventSpec.fields);
  const factValues = normalizedFactValues(eventSpec.kind, decodedPayload);
  if (
    candidate.chainId !== 1 ||
    !/^(?:0|[1-9]\d*)$/u.test(candidate.blockNumber) ||
    !/^(?:0|[1-9]\d*)$/u.test(candidate.blockTimestamp) ||
    BigInt(candidate.blockNumber) > 9_223_372_036_854_775_807n ||
    BigInt(candidate.blockTimestamp) > (1n << 64n) - 1n ||
    !Number.isSafeInteger(candidate.transactionIndex) ||
    candidate.transactionIndex < 0 ||
    candidate.transactionIndex > 0xffff_ffff ||
    !Number.isSafeInteger(candidate.blockGlobalLogIndex) ||
    candidate.blockGlobalLogIndex < 0 ||
    candidate.blockGlobalLogIndex > 0xffff_ffff ||
    candidate.orderedTopics.length < 1 ||
    candidate.orderedTopics.length > 4
  ) {
    return fail("occurrence placement");
  }
  const candidatePattern = /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/u.exec(
    candidate.candidateId,
  );
  if (
    !candidatePattern ||
    candidatePattern[1] !== candidate.blockHash ||
    candidatePattern[2] !== candidate.transactionHash ||
    candidatePattern[3] !== String(candidate.blockGlobalLogIndex)
  ) {
    return fail("candidate placement identity");
  }
  const orderedTopics = Object.freeze(
    candidate.orderedTopics.map((topic) => canonicalBytes32(topic)),
  );
  const occurrence: ProjectorOccurrenceFact = Object.freeze({
    candidateId: candidate.candidateId,
    chainId: "1",
    releaseId: release.releaseVersion,
    modelId: release.model,
    sourceGroup: "core",
    blockNumber: candidate.blockNumber,
    blockHash: canonicalBytes32(candidate.blockHash),
    blockTimestamp: candidate.blockTimestamp,
    transactionHash: canonicalBytes32(candidate.transactionHash),
    transactionIndex: String(candidate.transactionIndex),
    receiptLogOrdinal: String(evidence.receiptLogOrdinal),
    blockGlobalLogIndex: String(candidate.blockGlobalLogIndex),
    sourceAddress: canonicalAddress(candidate.sourceAddress),
    eventSignature: orderedTopics[0]!,
    eventType: candidate.eventName,
    orderedTopics,
    rawData: canonicalData(candidate.rawData),
    decodedPayload,
    payloadHash: canonicalBytes32(candidate.payloadHash),
    dynamicSourceAttestationId: evidence.dynamicSourceAttestationId ?? null,
  });
  const fact = Object.freeze({
    sourceCandidateId: candidate.candidateId,
    sourceRole: eventSpec.sourceRole,
    kind: eventSpec.kind,
    procedure: eventSpec.procedure,
    values: factValues,
  });
  validateFactInvariants(fact);
  return Object.freeze({ occurrence, fact });
}

function normalizedFactValues(
  kind: ProjectorFactKind,
  payload: Readonly<Record<string, CanonicalValue>>,
): Readonly<Record<string, CanonicalValue>> {
  if (kind !== "fee-accrual") return payload;
  const grossAmount =
    payload.grossNativeAmount ?? payload.grossQuoteAmount;
  if (typeof grossAmount !== "string") return fail("fee accrual gross amount");
  return Object.freeze({ ...payload, grossAmount });
}

function uint(values: Readonly<Record<string, CanonicalValue>>, key: string) {
  const value = values[key];
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return fail(`unsigned ${key}`);
  }
  return BigInt(value);
}

function text(values: Readonly<Record<string, CanonicalValue>>, key: string) {
  const value = values[key];
  if (typeof value !== "string") return fail(`scalar ${key}`);
  return value;
}

function bool(values: Readonly<Record<string, CanonicalValue>>, key: string) {
  const value = values[key];
  if (typeof value !== "boolean") return fail(`boolean ${key}`);
  return value;
}

function validateFactInvariants(fact: ProjectorEventFact) {
  const values = fact.values;
  if (fact.kind === "fee-accrual") {
    const gross = uint(
      values,
      "grossNativeAmount" in values ? "grossNativeAmount" : "grossQuoteAmount",
    );
    if (uint(values, "creatorFee") + uint(values, "launcherFee") > gross) {
      return fail("fee conservation");
    }
  }
  if (fact.kind === "fee-disclosure") {
    const buy = uint(values, "buySwapFeeBps");
    const sell = uint(values, "sellSwapFeeBps");
    const launcher = uint(values, "launcherFeeBps");
    if (buy > 10_000n || sell > 10_000n || launcher > buy || launcher > sell) {
      return fail("fee disclosure bounds");
    }
    const buyCreator = values.buyCreatorFeeBps ?? values.creatorFeeBps;
    const sellCreator = values.sellCreatorFeeBps ?? values.creatorFeeBps;
    if (
      typeof buyCreator === "string" &&
      typeof sellCreator === "string" &&
      (BigInt(buyCreator) + launcher !== buy || BigInt(sellCreator) + launcher !== sell)
    ) {
      return fail("fee disclosure conservation");
    }
    if (uint(values, "transferTaxBps") !== 0n) return fail("transfer tax");
  }
  if (fact.kind === "liquidity") {
    const supply = uint(values, "totalSupply");
    if (
      supply === 0n ||
      uint(values, "tokenLiquidityAmount") + uint(values, "lockedTokenDust") !== supply ||
      BigInt(text(values, "initialTick")) < MIN_TICK ||
      BigInt(text(values, "initialTick")) > MAX_TICK ||
      BigInt(text(values, "tickLower")) < MIN_TICK ||
      BigInt(text(values, "tickUpper")) > MAX_TICK ||
      BigInt(text(values, "tickLower")) >= BigInt(text(values, "tickUpper"))
    ) {
      return fail("liquidity invariant");
    }
  }
  if (fact.kind === "initial-buy") {
    const funding = "nativeAmount" in values ? "nativeAmount" : "quoteAmount";
    if (uint(values, funding) === 0n || uint(values, "tokenAmount") === 0n) {
      return fail("empty initial buy");
    }
  }
  if (fact.kind === "creator-fee-checkpoint") {
    if (uint(values, "amount") > uint(values, "totalCreatorFeesReceived")) {
      return fail("creator checkpoint total");
    }
  }
  if (fact.kind === "beneficiary-claim") {
    if (
      uint(values, "amount") > uint(values, "beneficiaryTotalClaimed") ||
      uint(values, "beneficiaryTotalClaimed") > uint(values, "vaultTotalReceived")
    ) {
      return fail("beneficiary claim totals");
    }
  }
  if (fact.kind === "payout-change") {
    const previous = text(
      values,
      "previousPayoutWallet" in values ? "previousPayoutWallet" : "previousPayoutAddress",
    );
    const next = text(
      values,
      "newPayoutWallet" in values ? "newPayoutWallet" : "newPayoutAddress",
    );
    if (previous === next) return fail("unchanged payout address");
  }
  if (fact.kind === "reward-configuration-activation") {
    const beneficiaries = values.beneficiaries;
    const shares = values.sharesBps;
    if (
      !Array.isArray(beneficiaries) ||
      !Array.isArray(shares) ||
      beneficiaries.length === 0 ||
      beneficiaries.length > 5 ||
      beneficiaries.length !== shares.length ||
      new Set(beneficiaries).size !== beneficiaries.length ||
      shares.reduce((sum, share) => sum + BigInt(share), 0n) !== 10_000n ||
      shares.some((share) => BigInt(share) === 0n)
    ) {
      return fail("reward configuration allocation");
    }
  }
}

export function projectorFoldManifestCoverage() {
  const manifest = Object.entries(PROJECTOR_EVENT_SIGNATURES)
    .flatMap(([contractName, signatures]) =>
      signatures.map((signature) => {
        const eventName = /^([A-Za-z][A-Za-z0-9]*)\(/u.exec(signature)?.[1];
        if (!eventName) return fail("malformed event manifest");
        return { contractName, eventName };
      }),
    )
    .sort((left, right) =>
      `${left.contractName}:${left.eventName}`.localeCompare(
        `${right.contractName}:${right.eventName}`,
      ),
    );
  const specs = Object.entries(EVENT_SPECS)
    .flatMap(([contractName, events]) =>
      Object.keys(events).map((eventName) => ({ contractName, eventName })),
    )
    .sort((left, right) =>
      `${left.contractName}:${left.eventName}`.localeCompare(
        `${right.contractName}:${right.eventName}`,
      ),
    );
  if (JSON.stringify(manifest) !== JSON.stringify(specs)) {
    return fail("manifest/spec drift");
  }
  return Object.freeze(manifest.map((entry) => Object.freeze(entry)));
}

/**
 * Exact projector rule authority used by the hosted bootstrap planner.
 *
 * Contract names remain part of this boundary so a semantic source role is
 * never reconstructed from a display name or naming convention.
 */
export function projectorFoldProjectionRules() {
  projectorFoldManifestCoverage();
  return Object.freeze(
    Object.entries(EVENT_SPECS)
      .flatMap(([contractName, events]) =>
        Object.entries(events).map(([eventName, eventSpec]) =>
          Object.freeze({
            contractName,
            eventName,
            sourceRole: eventSpec.sourceRole,
            projectionKind: eventSpec.kind,
          }),
        ),
      )
      .sort((left, right) =>
        `${left.contractName}:${left.eventName}`.localeCompare(
          `${right.contractName}:${right.eventName}`,
        ),
      ),
  );
}

projectorFoldManifestCoverage();

type Registration = Readonly<{
  releaseVersion: ProjectorRelease;
  sourceAddress: HexAddress;
  candidateId: string;
  values: Readonly<Record<string, CanonicalValue>>;
}>;
type Disclosure = Registration;
type VaultDeployment = Registration;
type PendingLaunch = {
  releaseVersion: ProjectorRelease;
  model: ProjectorModel;
  transactionHash: HexBytes32;
  launch: ProjectorEventFact;
  launchOccurrence: ProjectorOccurrenceFact;
  liquidity?: ProjectorEventFact;
  liquidityOccurrence?: ProjectorOccurrenceFact;
  initialBuy?: ProjectorEventFact;
  custody?: ProjectorEventFact;
  coordinator?: ProjectorEventFact;
};

export type ProjectorCompletedLaunch = Readonly<{
  releaseVersion: ProjectorRelease;
  model: ProjectorModel;
  token: HexAddress;
  creator: HexAddress;
  poolId: HexBytes32;
  rewardVault: HexAddress | null;
  launchHash: HexBytes32;
  launchTransactionHash: HexBytes32;
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string;
  positionRecipient: HexAddress;
  positionTokenId: string;
  pool: Readonly<{
    currency0: HexAddress;
    currency1: HexAddress;
    poolKeyFee: string;
    tickSpacing: "200";
    hook: HexAddress;
    sourceCandidateId: string;
  }>;
  feeConfiguration: Readonly<{
    buySwapFeeBps: string;
    sellSwapFeeBps: string;
    buyCreatorFeeBps: string;
    sellCreatorFeeBps: string;
    launcherFeeBps: string;
    transferTaxBps: string;
    lpFeePips: string;
    sourceCandidateId: string;
  }>;
  liquidity: Readonly<{
    tokenLiquidityAmount: string;
    lockedTokenDust: string;
    initialSqrtPriceX96: string;
    initialTick: string;
    tickLower: string;
    tickUpper: string;
    sourceCandidateId: string;
  }>;
  initialBuy: Readonly<{
    fundingAsset: HexAddress;
    fundingAmount: string;
    tokenAmount: string;
    sourceCandidateId: string;
  }>;
  custody: null | Readonly<{
    address: HexAddress;
    mode: string;
    durationDays: string;
    cliffDays: string;
    configurationHash: HexBytes32;
    sourceCandidateId: string;
    vestingSourceCandidateId: string | null;
    vestingStartTimestamp: string | null;
    vestingEndTimestamp: string | null;
  }>;
  ethFunded: boolean;
  occurrenceRoles: readonly Readonly<{
    sourceRole: SourceRole;
    candidateId: string;
  }>[];
}>;

export type ProjectorKnownPool = Readonly<{
  releaseVersion: ProjectorRelease;
  poolId: HexBytes32;
  token: HexAddress;
  quoteAsset: HexAddress | null;
  rewardVault: HexAddress | null;
}>;

export type ProjectorFoldResult = Readonly<{
  occurrences: readonly ProjectorOccurrenceFact[];
  facts: readonly ProjectorEventFact[];
  launches: readonly ProjectorCompletedLaunch[];
  knownPools: readonly ProjectorKnownPool[];
}>;

function eventOrderKey(occurrence: ProjectorOccurrenceFact) {
  return [
    BigInt(occurrence.blockNumber),
    BigInt(occurrence.transactionIndex),
    BigInt(occurrence.blockGlobalLogIndex),
  ] as const;
}

function after(left: ProjectorOccurrenceFact, right: ProjectorOccurrenceFact) {
  const a = eventOrderKey(left);
  const b = eventOrderKey(right);
  return a[0] > b[0] ||
    (a[0] === b[0] &&
      (a[1] > b[1] ||
        (a[1] === b[1] &&
          (a[2] > b[2] ||
            (a[2] === b[2] && left.candidateId > right.candidateId)))));
}

function addressOrder(left: string, right: string) {
  return BigInt(left) < BigInt(right) ? [left, right] : [right, left];
}

function launcherAddress(releaseVersion: ProjectorRelease) {
  const contractName =
    releaseVersion === "classic-v2"
      ? "ClassicV2Launcher"
      : releaseVersion === "classic-v3"
        ? "ClassicV3Launcher"
        : releaseVersion === "stock-paired-v1"
          ? "StockV1Launcher"
          : releaseVersion === "stock-paired-v2"
            ? "StockV2Launcher"
            : "StockV3Launcher";
  const source = RELEASE_BINDING.sources.find((item) => item.contractName === contractName);
  if (!source) return fail("launcher source binding");
  return source.address;
}

function tickToSqrtPriceX96(tickText: string): string {
  const tick = BigInt(tickText);
  if (tick < MIN_TICK || tick > MAX_TICK) return fail("tick math range");
  const absTick = tick < 0n ? -tick : tick;
  let ratio =
    absTick & 1n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  const constants: readonly [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [mask, constant] of constants) {
    if (absTick & mask) ratio = (ratio * constant) >> 128n;
  }
  if (tick > 0n) ratio = MAX_UINT256 / ratio;
  const remainder = ratio & ((1n << 32n) - 1n);
  return ((ratio >> 32n) + (remainder === 0n ? 0n : 1n)).toString();
}

function metadataFor(
  input: Readonly<Record<string, Readonly<{ name: string; symbol: string }>>> | undefined,
  token: string,
) {
  const metadata = input?.[token];
  if (
    !metadata ||
    typeof metadata.name !== "string" ||
    typeof metadata.symbol !== "string" ||
    Buffer.byteLength(metadata.name, "utf8") < 1 ||
    Buffer.byteLength(metadata.name, "utf8") > 128 ||
    Buffer.byteLength(metadata.symbol, "utf8") < 1 ||
    Buffer.byteLength(metadata.symbol, "utf8") > 32
  ) {
    return fail("missing token metadata enrichment");
  }
  return metadata;
}

function txMatches(pending: PendingLaunch, occurrence: ProjectorOccurrenceFact) {
  return pending.transactionHash === occurrence.transactionHash;
}

export function foldProjectorEvents(input: Readonly<{
  events: readonly ProjectorFoldEvent[];
  tokenMetadata?: Readonly<Record<string, Readonly<{ name: string; symbol: string }>>>;
  knownPools?: readonly ProjectorKnownPool[];
}>): ProjectorFoldResult {
  const translated = input.events.map(translateProjectorEvent);
  for (let index = 1; index < translated.length; index += 1) {
    if (!after(translated[index]!.occurrence, translated[index - 1]!.occurrence)) {
      return fail("event order");
    }
  }
  if (new Set(translated.map(({ occurrence }) => occurrence.candidateId)).size !== translated.length) {
    return fail("duplicate occurrence");
  }

  const registrations = new Map<string, Registration>();
  const disclosures = new Map<string, Disclosure>();
  const vaults = new Map<string, VaultDeployment>();
  const vestingWallets = new Map<string, VaultDeployment>();
  const pendingByToken = new Map<string, PendingLaunch>();
  const knownPools = new Map<string, ProjectorKnownPool>();
  for (const pool of input.knownPools ?? []) {
    if (knownPools.has(pool.poolId)) return fail("duplicate known pool parent");
    knownPools.set(pool.poolId, Object.freeze({ ...pool }));
  }

  for (const { occurrence, fact } of translated) {
    const values = fact.values;
    if (fact.kind === "pool-registration") {
      const poolId = text(values, "poolId");
      if (registrations.has(poolId) || knownPools.has(poolId)) {
        return fail("duplicate pool parent");
      }
      if (text(values, "registrar") !== launcherAddress(occurrence.releaseId)) {
        return fail("pool registrar parent");
      }
      registrations.set(poolId, {
        releaseVersion: occurrence.releaseId,
        sourceAddress: occurrence.sourceAddress,
        candidateId: occurrence.candidateId,
        values,
      });
      continue;
    }
    if (fact.kind === "fee-disclosure") {
      const poolId = text(values, "poolId");
      const parent = registrations.get(poolId);
      if (!parent || parent.releaseVersion !== occurrence.releaseId) {
        return fail("fee disclosure parent");
      }
      if (
        text(parent.values, "token") !== text(values, "token") ||
        ("rewardVault" in values &&
          text(parent.values, "rewardVault") !== text(values, "rewardVault")) ||
        ("quoteAsset" in values &&
          text(parent.values, "quoteAsset") !== text(values, "quoteAsset"))
      ) {
        return fail("fee disclosure relation");
      }
      disclosures.set(poolId, {
        releaseVersion: occurrence.releaseId,
        sourceAddress: occurrence.sourceAddress,
        candidateId: occurrence.candidateId,
        values,
      });
      continue;
    }
    if (fact.kind === "reward-vault-deployment") {
      const vault = text(values, "vault");
      if (vault === ZERO_ADDRESS || vaults.has(vault)) return fail("reward vault parent");
      vaults.set(vault, {
        releaseVersion: occurrence.releaseId,
        sourceAddress: occurrence.sourceAddress,
        candidateId: occurrence.candidateId,
        values,
      });
      continue;
    }
    if (fact.kind === "vesting-wallet-deployment") {
      const wallet = text(values, "wallet");
      if (wallet === ZERO_ADDRESS || vestingWallets.has(wallet)) return fail("vesting parent");
      vestingWallets.set(wallet, {
        releaseVersion: occurrence.releaseId,
        sourceAddress: occurrence.sourceAddress,
        candidateId: occurrence.candidateId,
        values,
      });
      continue;
    }
    if (fact.kind === "launch") {
      const token = text(values, "token");
      const poolId = text(values, "poolId");
      const registration = registrations.get(poolId);
      const disclosure = disclosures.get(poolId);
      if (!registration || !disclosure) return fail("launch pool parent");
      if (
        registration.releaseVersion !== occurrence.releaseId ||
        text(registration.values, "token") !== token ||
        text(values, "feeHook") !== registration.sourceAddress
      ) {
        return fail("launch pool relation");
      }
      if (pendingByToken.has(token)) return fail("duplicate launch parent");
      const rewardVault = values.rewardVault;
      if (typeof rewardVault === "string") {
        const vault = vaults.get(rewardVault);
        if (!vault || vault.releaseVersion !== occurrence.releaseId) {
          return fail("launch reward vault parent");
        }
        if (
          text(vault.values, "poolId") !== poolId ||
          text(vault.values, "feeHook") !== registration.sourceAddress ||
          ("configurationHash" in vault.values &&
            text(vault.values, "configurationHash") !==
              text(values, "rewardConfigurationHash"))
        ) {
          return fail("launch reward vault relation");
        }
      }
      pendingByToken.set(token, {
        releaseVersion: occurrence.releaseId,
        model: occurrence.modelId,
        transactionHash: occurrence.transactionHash,
        launch: fact,
        launchOccurrence: occurrence,
      });
      continue;
    }
    if (fact.kind === "liquidity") {
      const token = text(values, "token");
      const pending = pendingByToken.get(token);
      if (!pending || !txMatches(pending, occurrence) || pending.liquidity) {
        return fail("liquidity parent");
      }
      if (text(values, "launchHash") !== text(pending.launch.values, "launchHash")) {
        return fail("liquidity launch relation");
      }
      pending.liquidity = fact;
      pending.liquidityOccurrence = occurrence;
      continue;
    }
    if (fact.kind === "initial-buy") {
      const token = text(values, "token");
      const pending = pendingByToken.get(token);
      if (!pending || !txMatches(pending, occurrence) || pending.initialBuy) {
        return fail("initial buy parent");
      }
      const actor = "creator" in values ? "creator" : "deployer";
      const launchActor = "creator" in pending.launch.values ? "creator" : "deployer";
      if (
        text(values, "poolId") !== text(pending.launch.values, "poolId") ||
        text(values, "launchHash") !== text(pending.launch.values, "launchHash") ||
        text(values, actor) !== text(pending.launch.values, launchActor)
      ) {
        return fail("initial buy launch relation");
      }
      pending.initialBuy = fact;
      continue;
    }
    if (fact.kind === "initial-buy-custody") {
      const token = text(values, "token");
      const pending = pendingByToken.get(token);
      if (!pending || !txMatches(pending, occurrence) || pending.custody) {
        return fail("custody parent");
      }
      if (
        text(values, "launchHash") !== text(pending.launch.values, "launchHash") ||
        text(values, "deployer") !== text(pending.launch.values, "deployer")
      ) {
        return fail("custody launch relation");
      }
      validateCustody(values, vestingWallets);
      pending.custody = fact;
      continue;
    }
    if (fact.kind === "eth-launch-coordinator") {
      const token = text(values, "token");
      const pending = pendingByToken.get(token);
      if (!pending || !txMatches(pending, occurrence) || pending.coordinator) {
        return fail("coordinator launch parent");
      }
      if (
        text(values, "creator") !== text(pending.launch.values, "deployer") ||
        text(values, "quoteAsset") !== text(pending.launch.values, "quoteAsset") ||
        text(values, "launchHash") !== text(pending.launch.values, "launchHash") ||
        !pending.initialBuy ||
        text(values, "initialBuyQuoteAmount") !== text(pending.initialBuy.values, "quoteAmount") ||
        text(values, "initialBuyTokenAmount") !== text(pending.initialBuy.values, "tokenAmount") ||
        uint(values, "initialBuyEthAmount") === 0n
      ) {
        return fail("coordinator launch relation");
      }
      pending.coordinator = fact;
      continue;
    }
    if (
      ["fee-accrual", "creator-hook-claim"].includes(fact.kind) &&
      !registrations.has(text(values, "poolId")) &&
      !knownPools.has(text(values, "poolId"))
    ) {
      return fail("fee event pool parent");
    }
  }

  const launches: ProjectorCompletedLaunch[] = [];
  for (const pending of pendingByToken.values()) {
    launches.push(
      completeLaunch({
        pending,
        registrations,
        disclosures,
        vaults,
        vestingWallets,
        tokenMetadata: input.tokenMetadata,
      }),
    );
  }
  for (const launch of launches) {
    knownPools.set(
      launch.poolId,
      Object.freeze({
        releaseVersion: launch.releaseVersion,
        poolId: launch.poolId,
        token: launch.token,
        quoteAsset: launch.model === "classic" ? null : launch.initialBuy.fundingAsset,
        rewardVault: launch.rewardVault,
      }),
    );
  }
  return Object.freeze({
    occurrences: Object.freeze(translated.map(({ occurrence }) => occurrence)),
    facts: Object.freeze(translated.map(({ fact }) => fact)),
    launches: Object.freeze(launches),
    knownPools: Object.freeze([...knownPools.values()]),
  });
}

function validateCustody(
  values: Readonly<Record<string, CanonicalValue>>,
  vestingWallets: ReadonlyMap<string, VaultDeployment>,
) {
  const mode = uint(values, "mode");
  const duration = uint(values, "durationDays");
  const cliff = uint(values, "cliffDays");
  const custody = text(values, "custody");
  if (mode > 3n) return fail("custody mode");
  if (mode === 0n) {
    if (custody !== ZERO_ADDRESS || duration !== 0n || cliff !== 0n) {
      return fail("unlocked custody schedule");
    }
    return;
  }
  if (custody === ZERO_ADDRESS || duration < 1n || duration > 3650n) {
    return fail("locked custody schedule");
  }
  if (mode === 3n) {
    if (cliff < 1n || cliff >= duration) return fail("custody cliff schedule");
  } else if (cliff !== 0n) {
    return fail("custody cliff mode");
  }
  const parent = vestingWallets.get(custody);
  if (
    !parent ||
    text(parent.values, "token") !== text(values, "token") ||
    text(parent.values, "beneficiary") !== text(values, "deployer") ||
    text(parent.values, "configurationHash") !== text(values, "configurationHash")
  ) {
    return fail("locked custody vesting parent");
  }
}

function completeLaunch(input: {
  pending: PendingLaunch;
  registrations: ReadonlyMap<string, Registration>;
  disclosures: ReadonlyMap<string, Disclosure>;
  vaults: ReadonlyMap<string, VaultDeployment>;
  vestingWallets: ReadonlyMap<string, VaultDeployment>;
  tokenMetadata: Readonly<Record<string, Readonly<{ name: string; symbol: string }>>> | undefined;
}): ProjectorCompletedLaunch {
  const { pending } = input;
  if (!pending.liquidity || !pending.liquidityOccurrence || !pending.initialBuy) {
    return fail("incomplete launch");
  }
  if (pending.releaseVersion === "classic-v3" && !pending.custody) {
    return fail("incomplete Classic v3 custody launch");
  }
  const launch = pending.launch.values;
  const liquidity = pending.liquidity.values;
  const initialBuy = pending.initialBuy.values;
  const token = canonicalAddress(text(launch, "token"));
  const poolId = canonicalBytes32(text(launch, "poolId"));
  const registration = input.registrations.get(poolId);
  const disclosure = input.disclosures.get(poolId);
  if (!registration || !disclosure) return fail("incomplete launch pool");
  const metadata = metadataFor(input.tokenMetadata, token);
  const creator = canonicalAddress(text(launch, "creator" in launch ? "creator" : "deployer"));
  if (
    ("creator" in registration.values && text(registration.values, "creator") !== creator) ||
    ("totalSwapFeeBps" in launch &&
      (text(launch, "totalSwapFeeBps") !== text(registration.values, "totalSwapFeeBps") ||
        text(launch, "totalSwapFeeBps") !== text(disclosure.values, "buySwapFeeBps") ||
        text(launch, "totalSwapFeeBps") !== text(disclosure.values, "sellSwapFeeBps"))) ||
    ("buySwapFeeBps" in launch &&
      (text(launch, "buySwapFeeBps") !== text(disclosure.values, "buySwapFeeBps") ||
        text(launch, "sellSwapFeeBps") !== text(disclosure.values, "sellSwapFeeBps"))) ||
    text(liquidity, "lpFeePips") !== text(disclosure.values, "lpFeePips")
  ) {
    return fail("launch economics relation");
  }
  const quoteAsset =
    pending.model === "classic"
      ? ZERO_ADDRESS
      : text(launch, "quoteAsset");
  if (
    pending.model === "stock-paired" &&
    (text(liquidity, "quoteAsset") !== quoteAsset ||
      text(initialBuy, "quoteAsset") !== quoteAsset ||
      bool(registration.values, "quoteIsCurrency0") !== (BigInt(quoteAsset) < BigInt(token)))
  ) {
    return fail("stock quote relation");
  }
  const [currency0, currency1] = addressOrder(
    pending.model === "classic" ? ZERO_ADDRESS : quoteAsset,
    token,
  ) as [HexAddress, HexAddress];
  const launcher = text(disclosure.values, "launcherFeeBps");
  const buy = text(disclosure.values, "buySwapFeeBps");
  const sell = text(disclosure.values, "sellSwapFeeBps");
  const buyCreator =
    typeof disclosure.values.buyCreatorFeeBps === "string"
      ? disclosure.values.buyCreatorFeeBps
      : typeof disclosure.values.creatorFeeBps === "string"
        ? disclosure.values.creatorFeeBps
        : (BigInt(buy) - BigInt(launcher)).toString();
  const sellCreator =
    typeof disclosure.values.sellCreatorFeeBps === "string"
      ? disclosure.values.sellCreatorFeeBps
      : typeof disclosure.values.creatorFeeBps === "string"
        ? disclosure.values.creatorFeeBps
        : (BigInt(sell) - BigInt(launcher)).toString();
  const occurrenceRoles: { sourceRole: SourceRole; candidateId: string }[] = [
    { sourceRole: "launcher", candidateId: pending.launch.sourceCandidateId },
  ];
  const rewardVault =
    typeof launch.rewardVault === "string"
      ? canonicalAddress(launch.rewardVault)
      : null;
  if (rewardVault) {
    const parent = input.vaults.get(rewardVault);
    if (!parent) return fail("reward vault launch requirement");
    occurrenceRoles.push({
      sourceRole: "vault_factory",
      candidateId: parent.candidateId,
    });
  }
  let custody: ProjectorCompletedLaunch["custody"] = null;
  if (pending.custody) {
    const values = pending.custody.values;
    const mode = uint(values, "mode");
    const duration = uint(values, "durationDays");
    const cliff = uint(values, "cliffDays");
    const custodyAddress = canonicalAddress(text(values, "custody"));
    let vestingSourceCandidateId: string | null = null;
    let vestingStartTimestamp: string | null = null;
    let vestingEndTimestamp: string | null = null;
    if (mode !== 0n) {
      const vesting = input.vestingWallets.get(custodyAddress);
      if (!vesting) return fail("vesting launch requirement");
      vestingSourceCandidateId = vesting.candidateId;
      occurrenceRoles.push({ sourceRole: "vesting_factory", candidateId: vesting.candidateId });
      const launchTime = BigInt(pending.launchOccurrence.blockTimestamp);
      const start =
        mode === 2n
          ? launchTime
          : launchTime + (mode === 3n ? cliff : duration) * 86_400n;
      const end = launchTime + duration * 86_400n;
      vestingStartTimestamp = start.toString();
      vestingEndTimestamp = end.toString();
    }
    custody = Object.freeze({
      address: custodyAddress,
      mode: mode.toString(),
      durationDays: duration.toString(),
      cliffDays: cliff.toString(),
      configurationHash: canonicalBytes32(text(values, "configurationHash")),
      sourceCandidateId: pending.custody.sourceCandidateId,
      vestingSourceCandidateId,
      vestingStartTimestamp,
      vestingEndTimestamp,
    });
  }
  if (pending.coordinator) {
    occurrenceRoles.push({
      sourceRole: "coordinator",
      candidateId: pending.coordinator.sourceCandidateId,
    });
  }
  return Object.freeze({
    releaseVersion: pending.releaseVersion,
    model: pending.model,
    token,
    creator,
    poolId,
    rewardVault,
    launchHash: canonicalBytes32(text(launch, "launchHash")),
    launchTransactionHash: pending.transactionHash,
    tokenName: metadata.name,
    tokenSymbol: metadata.symbol,
    totalSupply: text(liquidity, "totalSupply"),
    positionRecipient: canonicalAddress(text(launch, "positionRecipient")),
    positionTokenId: text(launch, "positionTokenId"),
    pool: Object.freeze({
      currency0: canonicalAddress(currency0),
      currency1: canonicalAddress(currency1),
      poolKeyFee: text(disclosure.values, "lpFeePips"),
      tickSpacing: "200",
      hook: registration.sourceAddress,
      sourceCandidateId: registration.candidateId,
    }),
    feeConfiguration: Object.freeze({
      buySwapFeeBps: buy,
      sellSwapFeeBps: sell,
      buyCreatorFeeBps: buyCreator,
      sellCreatorFeeBps: sellCreator,
      launcherFeeBps: launcher,
      transferTaxBps: text(disclosure.values, "transferTaxBps"),
      lpFeePips: text(disclosure.values, "lpFeePips"),
      sourceCandidateId: disclosure.candidateId,
    }),
    liquidity: Object.freeze({
      tokenLiquidityAmount: text(liquidity, "tokenLiquidityAmount"),
      lockedTokenDust: text(liquidity, "lockedTokenDust"),
      initialSqrtPriceX96: tickToSqrtPriceX96(text(liquidity, "initialTick")),
      initialTick: text(liquidity, "initialTick"),
      tickLower: text(liquidity, "tickLower"),
      tickUpper: text(liquidity, "tickUpper"),
      sourceCandidateId: pending.liquidity.sourceCandidateId,
    }),
    initialBuy: Object.freeze({
      fundingAsset: canonicalAddress(quoteAsset),
      fundingAmount: text(
        initialBuy,
        "nativeAmount" in initialBuy ? "nativeAmount" : "quoteAmount",
      ),
      tokenAmount: text(initialBuy, "tokenAmount"),
      sourceCandidateId: pending.initialBuy.sourceCandidateId,
    }),
    custody,
    ethFunded: pending.coordinator !== undefined,
    occurrenceRoles: Object.freeze(occurrenceRoles.map((item) => Object.freeze(item))),
  });
}
