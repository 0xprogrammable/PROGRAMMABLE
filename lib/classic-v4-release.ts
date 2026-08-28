import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import classicV4ReleaseSchema from "../contracts/deployments/schema/classic-v4-release-v1.schema.json" with { type: "json" };
import {
  CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  isClassicV4AnchoredPublicReleaseBinding,
  type ClassicV4FinalizedLaunchAnchor,
  type ClassicV4PublicReleaseBinding,
} from "./classic-v4-public-release";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../scripts/classic-v4-digest.mjs";
// The release tool is the canonical 51d93b Router authorization verifier.
// @ts-expect-error The frozen operational .mjs intentionally has no TS declaration surface.
import { classicV4ReleaseBindingDigest as classicV4ReleaseBindingDigestCore, validateClassicV4LaunchAuthorization as validateClassicV4LaunchAuthorizationCore } from "../scripts/classic-v4-release-core.mjs";
import { CLASSIC_V4_LAUNCH_STAMP_ROUTER } from "./classic-v4";

export const CLASSIC_V4_RELEASE_MANIFEST_PATH =
  "contracts/deployments/mainnet-classic-v4.json";

const NEW_CONTRACTS = [
  "hookFactory",
  "feeHook",
  "positionPlanner",
  "launcher",
] as const;
const SHARED_CONTRACTS = [
  "ctoAuthority",
  "rewardVaultFactory",
  "initialBuyVestingWalletFactory",
  "launchPolicy",
  "positionForwarderFactory",
] as const;
const OFFICIAL_DEPENDENCIES = [
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "uerc20Factory",
  "permit2",
  "universalRouter",
] as const;
const EXPECTED_OFFICIAL_DEPENDENCIES = {
  poolManager: [
    "0x000000000004444c5dc75cB358380D2e3dE08A90",
    "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  ],
  positionManager: [
    "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
  ],
  stateView: [
    "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
  ],
  v4Quoter: [
    "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  ],
  uerc20Factory: [
    "0x000000e200088D55C39a11F609E5F667729ad49b",
    "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
  ],
  permit2: [
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  ],
  universalRouter: [
    "0xd92A36B0000531EF3063dEd4De20A0783308446C",
    "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
  ],
} as const;
const LIFECYCLE_ACTIONS = [
  "launch",
  "buyExactInput",
  "buyExactOutput",
  "sellExactInput",
  "sellExactOutput",
  "creatorClaim",
  "launcherClaim",
] as const;
const LIFECYCLE_INVARIANTS = [
  "launchVerified",
  "positionLockVerified",
  "buyExactInputVerified",
  "buyExactOutputVerified",
  "sellExactInputVerified",
  "sellExactOutputVerified",
  "creatorClaimVerified",
  "launcherClaimVerified",
  "feeConservationVerified",
] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const CLASSIC_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
const CLASSIC_V4_CANARY_INITIAL_BUY = 600_000_000_000_000n;
const SWAP_IDENTITIES = {
  buyExactInput: ["buy", "exact-input"],
  buyExactOutput: ["buy", "exact-output"],
  sellExactInput: ["sell", "exact-input"],
  sellExactOutput: ["sell", "exact-output"],
} as const;
const SWAP_EXACT_AMOUNTS = {
  buyExactInput: 100_000_000_000_000n,
  buyExactOutput: 1_000_000_000_000_000_000n,
  sellExactInput: 1_000_000_000_000_000_000n,
  sellExactOutput: 1_000_000_000n,
} as const;
const ACTION_EVENT_KEYS = {
  launch: [
    "ProgrammableComponentStampedV1.token",
    "ProgrammableComponentStampedV1.rewardVault",
    "ProgrammableComponentStampedV1.positionRecipient",
    "ProgrammableComponentStampedV1.feeHook",
    "ProgrammableLaunchRouteStampedV1",
    "ProgrammableLaunchStampedV1",
    "MemeTokenLaunchedV2",
    "MemeLiquidityConfiguredV2",
    "MemeCreatorInitialBuyV2",
    "MemeCreatorInitialBuyCustodyV2",
    "PoolRegistered",
    "PoolFeeDisclosure",
    "NativeSwapFeesAccrued",
    "HookFee",
    "HookSwap",
    "PoolManagerSwap",
  ],
  buyExactInput: [
    "NativeSwapFeesAccrued",
    "HookFee",
    "HookSwap",
    "PoolManagerSwap",
  ],
  buyExactOutput: [
    "NativeSwapFeesAccrued",
    "HookFee",
    "HookSwap",
    "PoolManagerSwap",
  ],
  sellExactInput: [
    "NativeSwapFeesAccrued",
    "HookFee",
    "HookSwap",
    "PoolManagerSwap",
  ],
  sellExactOutput: [
    "NativeSwapFeesAccrued",
    "HookFee",
    "HookSwap",
    "PoolManagerSwap",
  ],
  creatorClaim: [
    "CreatorFeesClaimed",
    "CreatorFeesCheckpointed",
    "BeneficiaryFeesClaimed",
  ],
  launcherClaim: ["LauncherFeesClaimed"],
} as const;

const classicV4ReleaseAjv = new Ajv2020({ allErrors: false, strict: true });
addFormats(classicV4ReleaseAjv);
const validateClassicV4ReleaseSchema = classicV4ReleaseAjv.compile(
  classicV4ReleaseSchema,
);

type ContractName =
  (typeof NEW_CONTRACTS)[number] | (typeof SHARED_CONTRACTS)[number];
type DependencyName = (typeof OFFICIAL_DEPENDENCIES)[number];

type AddressAndRuntime = {
  address: Address;
  runtimeCodeHash: Hex;
};

export type ClassicV4PublicRelease = {
  schemaVersion: 1;
  model: "classic";
  internalContractRelease: "classic-v4";
  releaseStatus: "indexer-activated" | "publicly-available";
  chainId: 1;
  releaseCommit: string;
  releaseTree: string;
  sourceCommitment: Hex;
  planDigest: Hex;
  manifestDigest: Hex;
  capturedAt: string;
  startBlock: number;
  addresses: Record<
    ContractName | "deployer" | "launcherFeeRecipient",
    Address
  >;
  deploymentTransactions: Record<(typeof NEW_CONTRACTS)[number], Hex>;
  deploymentBlocks: Record<(typeof NEW_CONTRACTS)[number], number>;
  deploymentVerification: {
    evidenceDigest: Hex;
    checkedAt: string;
    verificationBlock: number;
    verificationBlockHash: Hex;
    contractBlockHashes: Record<(typeof NEW_CONTRACTS)[number], Hex>;
    confirmations: Record<(typeof NEW_CONTRACTS)[number], number>;
  };
  runtimeCodeHashes: Record<ContractName, Hex>;
  runtimeTemplateHashes: Record<(typeof NEW_CONTRACTS)[number], Hex>;
  officialDependencies: Record<DependencyName, AddressAndRuntime>;
  sharedDependencies: Record<
    (typeof SHARED_CONTRACTS)[number],
    AddressAndRuntime
  >;
  verification: {
    deploymentLive: true;
    deploymentFinalized: true;
    independentRpcCount: number;
    runtimeCodeVerified: true;
    constructorBindingsVerified: true;
    sourceVerified: true;
    lifecycleVerified: true;
    indexerActivated: true;
    publicAvailable: boolean;
  };
  sourceVerification: Record<string, unknown>;
  lifecycleEvidence: Record<string, unknown>;
  indexerHandoff: Record<string, unknown> & {
    indexerBindingDigest: Hex;
  };
};

export type ClassicV4PendingRelease = Omit<
  ClassicV4PublicRelease,
  "releaseStatus" | "verification" | "indexerHandoff"
> & {
  releaseStatus: "deployment-source-and-lifecycle-verified";
  verification: Omit<
    ClassicV4PublicRelease["verification"],
    "indexerActivated" | "publicAvailable"
  > & {
    indexerActivated: false;
    publicAvailable: false;
  };
  indexerHandoff: Omit<
    ClassicV4PublicRelease["indexerHandoff"],
    "indexerBindingDigest"
  > & {
    indexerBindingDigest: null;
    activated: false;
  };
};

export type ClassicV4PublicActionRelease = ClassicV4PublicRelease & {
  releaseStatus: "publicly-available";
  verification: ClassicV4PublicRelease["verification"] & {
    publicAvailable: true;
  };
};

export function isClassicV4PublicActionRelease(
  release: ClassicV4PublicRelease | null | undefined,
): release is ClassicV4PublicActionRelease {
  return (
    release?.releaseStatus === "publicly-available" &&
    release.verification.publicAvailable === true
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: unknown, expected: readonly string[]) {
  const object = record(value);
  if (!object) return null;
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
    ? object
    : null;
}

function address(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  const canonical = getAddress(value);
  return canonical === "0x0000000000000000000000000000000000000000"
    ? null
    : canonical;
}

function bytes32(value: unknown): Hex | null {
  return typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66 &&
    BigInt(value) !== 0n
    ? (value.toLowerCase() as Hex)
    : null;
}

function calldata(value: unknown): Hex | null {
  return typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length >= 10
    ? (value.toLowerCase() as Hex)
    : null;
}

function commit(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{40}$/i.test(value) &&
    !/^0{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function blockNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function strictIsoDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function manifestDigest(value: Record<string, unknown>) {
  const unsigned = { ...value };
  delete unsigned.manifestDigest;
  return digestJson(unsigned, CLASSIC_V4_DIGEST_DOMAINS.releaseManifest);
}

export function classicV4IndexerBindingDigest(value: unknown) {
  return digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.releaseBinding);
}

function evidenceDigest(value: Record<string, unknown>, domain: string) {
  const unsigned = { ...value };
  delete unsigned.evidenceDigest;
  return digestJson(unsigned, domain);
}

function validAddressRuntimeMap(value: unknown, keys: readonly string[]) {
  const object = exactKeys(value, keys);
  if (!object) return false;
  return keys.every((key) => {
    const entry = exactKeys(object[key], ["address", "runtimeCodeHash"]);
    return Boolean(
      entry && address(entry.address) && bytes32(entry.runtimeCodeHash),
    );
  });
}

function sameAddressValue(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    isAddress(left) &&
    isAddress(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function decimalBigInt(
  value: unknown,
  options: { signed?: boolean; positive?: boolean } = {},
) {
  if (
    typeof value !== "string" ||
    !(options.signed
      ? /^(?:0|-?[1-9]\d*)$/.test(value)
      : /^(?:0|[1-9]\d*)$/.test(value))
  ) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return options.positive && parsed <= 0n ? null : parsed;
  } catch {
    return null;
  }
}

type ClassicV4AuthorizationProof = Readonly<{
  route: Readonly<{
    expectedResult: Readonly<{
      token: Address;
      rewardVault: Address;
      positionRecipient: Address;
      positionTokenId: bigint;
      lockedTokenDust: bigint;
      poolId: Hex;
      launchHash: Hex;
    }>;
  }>;
  stampRequest: Readonly<{
    launchId: Hex;
    components: readonly Readonly<{
      resultIndex: number;
      runtimeCodeHash: Hex;
    }>[];
  }>;
}>;

const validateClassicV4LaunchAuthorization =
  validateClassicV4LaunchAuthorizationCore as (
    canary: Record<string, unknown>,
    value: unknown,
  ) => ClassicV4AuthorizationProof;

function validClassicV4RouterAuthorization(input: {
  lifecycle: Record<string, unknown>;
  addresses: Record<string, unknown>;
  runtimeCodeHashes: Record<string, unknown>;
}): ClassicV4FinalizedLaunchAnchor | null {
  const { lifecycle, addresses, runtimeCodeHashes } = input;
  const actions = record(lifecycle.actions);
  const launchAction = actions && record(actions.launch);
  const launchAuthorization = exactKeys(lifecycle.launchAuthorization, [
    "schemaVersion",
    "chainId",
    "releaseManifestDigest",
    "predictedToken",
    "predictedHook",
    "permitDigest",
    "validAfter",
    "deadline",
    "simulation",
    "transaction",
  ]);
  const launchSimulation =
    launchAuthorization &&
    exactKeys(launchAuthorization.simulation, [
      "blockNumber",
      "blockHash",
      "blockTimestamp",
      "gasEstimate",
      "stampHash",
    ]);
  const launchTransaction =
    launchAuthorization &&
    exactKeys(launchAuthorization.transaction, [
      "chainId",
      "from",
      "to",
      "valueWei",
      "calldata",
      "gasLimit",
    ]);
  const launchCalldata = calldata(launchTransaction?.calldata);
  const transactionHash = bytes32(launchAction?.transactionHash);
  const blockHash = bytes32(launchAction?.blockHash);
  const inputHash = bytes32(launchAction?.inputHash);
  const launchBlockNumber = blockNumber(launchAction?.blockNumber)
    ? launchAction.blockNumber
    : null;
  const permitDigest = bytes32(launchAuthorization?.permitDigest);
  const stampHash = bytes32(launchSimulation?.stampHash);
  const launchTimestamp = decimalBigInt(launchAction?.blockTimestamp, {
    positive: true,
  });
  const simulationBlock = decimalBigInt(launchSimulation?.blockNumber, {
    positive: true,
  });
  if (
    !launchAction ||
    !launchAuthorization ||
    !launchSimulation ||
    !launchTransaction ||
    !transactionHash ||
    !blockHash ||
    !inputHash ||
    launchBlockNumber === null ||
    !permitDigest ||
    !stampHash ||
    launchAuthorization.schemaVersion !==
      "programmable.classic-launch-authorization.v1" ||
    launchAuthorization.chainId !== "1" ||
    launchTransaction.chainId !== "1" ||
    !bytes32(lifecycle.launchAuthorizationDigest) ||
    String(lifecycle.launchAuthorizationDigest).toLowerCase() !==
      digestJson(
        launchAuthorization,
        CLASSIC_V4_DIGEST_DOMAINS.lifecycleAuthorization,
      ).toLowerCase() ||
    String(launchAuthorization.releaseManifestDigest).toLowerCase() !==
      String(lifecycle.releaseBindingDigest).toLowerCase() ||
    !sameAddressValue(
      launchAuthorization.predictedToken,
      lifecycle.canaryToken,
    ) ||
    !sameAddressValue(launchAuthorization.predictedHook, lifecycle.feeHook) ||
    !sameAddressValue(launchTransaction.from, lifecycle.operatorWallet) ||
    !sameAddressValue(launchTransaction.to, CLASSIC_V4_LAUNCH_STAMP_ROUTER) ||
    !sameAddressValue(launchAction.to, CLASSIC_V4_LAUNCH_STAMP_ROUTER) ||
    !sameAddressValue(launchAction.from, lifecycle.operatorWallet) ||
    decimalBigInt(launchAction.value) !== CLASSIC_V4_CANARY_INITIAL_BUY ||
    !launchCalldata ||
    inputHash !== keccak256(launchCalldata).toLowerCase() ||
    launchTimestamp === null ||
    simulationBlock === null ||
    simulationBlock > BigInt(launchBlockNumber)
  ) {
    return null;
  }

  let proof: ClassicV4AuthorizationProof;
  try {
    proof = validateClassicV4LaunchAuthorization(
      {
        releaseBindingDigest: String(
          lifecycle.releaseBindingDigest,
        ).toLowerCase(),
        operatorWallet: getAddress(String(lifecycle.operatorWallet)),
        launcher: getAddress(String(addresses.launcher)),
        feeHook: getAddress(String(lifecycle.feeHook)),
        runtimeCodeHashes: {
          launcher: String(runtimeCodeHashes.launcher).toLowerCase(),
          feeHook: String(runtimeCodeHashes.feeHook).toLowerCase(),
        },
        launchFixture: {
          name: "Programmable Classic V4 Canary",
          symbol: "PCV4C",
          creatorSalt: digestJson(
            {
              purpose: "programmable-classic-v4-mainnet-lifecycle-canary",
              releaseBindingDigest: String(
                lifecycle.releaseBindingDigest,
              ).toLowerCase(),
              operatorWallet: getAddress(String(lifecycle.operatorWallet)),
            },
            CLASSIC_V4_DIGEST_DOMAINS.canaryCreatorSalt,
          ),
          metadata: {
            description: "Programmable Classic V4 Mainnet lifecycle canary",
            website: "https://programmable.market",
            image: "",
            extraData: "0x",
          },
          buySwapFeeBps: 100,
          sellSwapFeeBps: 200,
          initialBuyWei: CLASSIC_V4_CANARY_INITIAL_BUY.toString(),
          beneficiarySharesBps: [10_000],
        },
      },
      launchAuthorization,
    );
  } catch {
    return null;
  }

  const result = proof.route.expectedResult;
  const componentByResultIndex = new Map(
    proof.stampRequest.components.map((component) => [
      Number(component.resultIndex),
      component,
    ]),
  );
  const tokenComponent = componentByResultIndex.get(0);
  const rewardComponent = componentByResultIndex.get(1);
  const positionComponent = componentByResultIndex.get(2);
  const hookComponent = componentByResultIndex.get(255);
  const postState = record(lifecycle.postState);
  const launchMappings = postState && record(postState.launchMappings);
  const tokenCustody = postState && record(postState.tokenCustody);
  const derivedCodeHashes = postState && record(postState.derivedCodeHashes);
  if (!(
    sameAddressValue(result.token, lifecycle.canaryToken) &&
    sameAddressValue(result.rewardVault, lifecycle.rewardVault) &&
    sameAddressValue(result.positionRecipient, lifecycle.positionRecipient) &&
    String(result.poolId).toLowerCase() ===
      String(lifecycle.poolId).toLowerCase() &&
    result.positionTokenId === decimalBigInt(lifecycle.positionTokenId) &&
    launchTimestamp >= BigInt(String(launchAuthorization.validAfter)) &&
    launchTimestamp <= BigInt(String(launchAuthorization.deadline)) &&
    tokenComponent &&
    rewardComponent &&
    positionComponent &&
    hookComponent &&
    launchMappings &&
    String(launchMappings.launchHash).toLowerCase() ===
      result.launchHash.toLowerCase() &&
    tokenCustody &&
    decimalBigInt(tokenCustody.lockedTokenDust) === result.lockedTokenDust &&
    derivedCodeHashes &&
    String(derivedCodeHashes.token).toLowerCase() ===
      tokenComponent.runtimeCodeHash.toLowerCase() &&
    String(derivedCodeHashes.rewardVault).toLowerCase() ===
      rewardComponent.runtimeCodeHash.toLowerCase() &&
    String(derivedCodeHashes.positionForwarder).toLowerCase() ===
      positionComponent.runtimeCodeHash.toLowerCase() &&
    String(runtimeCodeHashes.feeHook).toLowerCase() ===
      hookComponent.runtimeCodeHash.toLowerCase()
  )) {
    return null;
  }

  return Object.freeze({
    transactionHash,
    blockHash,
    blockNumber: launchBlockNumber,
    inputHash,
    launchId: proof.stampRequest.launchId.toLowerCase() as Hex,
    stampHash,
    permitDigest,
  });
}

/**
 * Extracts the immutable finalized launch anchor from a release that has
 * already passed the complete pending/public manifest parser.
 */
export function deriveClassicV4FinalizedLaunchAnchor(
  release: ClassicV4PendingRelease | ClassicV4PublicRelease,
): ClassicV4FinalizedLaunchAnchor | null {
  const lifecycle = record(release.lifecycleEvidence);
  const addresses = record(release.addresses);
  const runtimeCodeHashes = record(release.runtimeCodeHashes);
  return lifecycle && addresses && runtimeCodeHashes
    ? validClassicV4RouterAuthorization({
        lifecycle,
        addresses,
        runtimeCodeHashes,
      })
    : null;
}

function sameHexValue(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function matchesClassicV4PublicReleaseBinding(input: {
  binding: ClassicV4PublicReleaseBinding | null | undefined;
  manifest: Record<string, unknown>;
  addresses: Record<string, unknown>;
  verification: Record<string, unknown>;
  launchAnchor: ClassicV4FinalizedLaunchAnchor;
}) {
  const { binding, manifest, addresses, verification, launchAnchor } = input;
  return Boolean(
    isClassicV4AnchoredPublicReleaseBinding(binding) &&
    binding.chainId === manifest.chainId &&
    binding.releaseStatus === manifest.releaseStatus &&
    binding.publicAvailable === verification.publicAvailable &&
    sameAddressValue(binding.launcher, addresses.launcher) &&
    sameHexValue(binding.manifestDigest, manifest.manifestDigest) &&
    sameHexValue(binding.transactionHash, launchAnchor.transactionHash) &&
    sameHexValue(binding.blockHash, launchAnchor.blockHash) &&
    binding.blockNumber === launchAnchor.blockNumber &&
    sameHexValue(binding.inputHash, launchAnchor.inputHash) &&
    sameHexValue(binding.launchId, launchAnchor.launchId) &&
    sameHexValue(binding.stampHash, launchAnchor.stampHash) &&
    sameHexValue(binding.permitDigest, launchAnchor.permitDigest),
  );
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function grossFeeSplit(gross: bigint, feeBps: number) {
  const total = (gross * BigInt(feeBps)) / 10_000n;
  const launcher = (gross * 10n) / 10_000n;
  return { creator: total - launcher, launcher, total };
}

function netFeeSplit(net: bigint, feeBps: number) {
  const denominator = 10_000n - BigInt(feeBps);
  const gross = (net * 10_000n + denominator - 1n) / denominator;
  const total = gross - net;
  const launcher = (gross * 10n) / 10_000n;
  return { creator: total - launcher, launcher, total };
}

function validEventIndices(value: unknown, expected: readonly string[]) {
  const events = exactKeys(value, expected);
  return Boolean(
    events && expected.every((key) => nonNegativeSafeInteger(events[key])),
  );
}

function validRichLifecycleEvidence(input: {
  lifecycle: Record<string, unknown>;
  manifest: Record<string, unknown>;
  addresses: Record<string, unknown>;
  runtimeCodeHashes: Record<string, unknown>;
  official: Record<string, unknown>;
  deploymentBlocks: Record<string, unknown>;
  deploymentVerification: Record<string, unknown>;
  source: Record<string, unknown>;
}) {
  const {
    lifecycle,
    manifest,
    addresses,
    runtimeCodeHashes,
    official,
    deploymentBlocks,
    deploymentVerification,
    source,
  } = input;
  let expectedReleaseBindingDigest: string;
  try {
    expectedReleaseBindingDigest = classicV4ReleaseBindingDigestCore({
      planDigest: manifest.planDigest,
      deploymentEvidenceDigest: deploymentVerification.evidenceDigest,
      sourceEvidenceDigest: source.evidenceDigest,
    });
  } catch {
    return false;
  }
  if (
    lifecycle.schemaVersion !== 1 ||
    lifecycle.chainId !== 1 ||
    String(lifecycle.planDigest).toLowerCase() !==
      String(manifest.planDigest).toLowerCase() ||
    String(lifecycle.sourceCommitment).toLowerCase() !==
      String(manifest.sourceCommitment).toLowerCase() ||
    lifecycle.status !== "verified-current-release" ||
    lifecycle.releaseEligible !== true ||
    lifecycle.independentRpcCount !== 2 ||
    !strictIsoDateTime(lifecycle.checkedAt) ||
    !bytes32(lifecycle.canaryPlanDigest) ||
    !bytes32(lifecycle.releaseBindingDigest) ||
    String(lifecycle.releaseBindingDigest).toLowerCase() !==
      expectedReleaseBindingDigest.toLowerCase() ||
    String(lifecycle.deploymentEvidenceDigest).toLowerCase() !==
      String(deploymentVerification.evidenceDigest).toLowerCase() ||
    String(lifecycle.sourceEvidenceDigest).toLowerCase() !==
      String(source.evidenceDigest).toLowerCase() ||
    !blockNumber(lifecycle.verificationBlock) ||
    Number(lifecycle.verificationBlock) <
      Number(deploymentVerification.verificationBlock) ||
    !bytes32(lifecycle.verificationBlockHash) ||
    !blockNumber(lifecycle.latestLifecycleBlock) ||
    !Number.isSafeInteger(lifecycle.confirmations) ||
    Number(lifecycle.confirmations) < 12 ||
    !address(lifecycle.operatorWallet) ||
    !sameAddressValue(lifecycle.launcher, addresses.launcher) ||
    !sameAddressValue(lifecycle.feeHook, addresses.feeHook) ||
    !address(lifecycle.canaryToken) ||
    !address(lifecycle.rewardVault) ||
    !address(lifecycle.positionRecipient) ||
    !bytes32(lifecycle.poolId) ||
    decimalBigInt(lifecycle.positionTokenId, { positive: true }) === null ||
    !bytes32(lifecycle.evidenceDigest) ||
    String(lifecycle.evidenceDigest).toLowerCase() !==
      evidenceDigest(
        lifecycle,
        CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
      ).toLowerCase()
  ) {
    return false;
  }

  const actions = record(lifecycle.actions);
  const universalRouter = record(official.universalRouter)?.address;
  if (!actions || !universalRouter) return false;
  const latestDeploymentBlock = Math.max(
    ...NEW_CONTRACTS.map((key) => Number(deploymentBlocks[key])),
  );
  const transactionHashes = new Set<string>();
  let previousBlock = Math.max(
    latestDeploymentBlock,
    Number(deploymentVerification.verificationBlock),
  );
  let previousOperatorNonce = -1;
  for (const actionName of LIFECYCLE_ACTIONS) {
    const action = record(actions[actionName]);
    const swapIdentity =
      SWAP_IDENTITIES[actionName as keyof typeof SWAP_IDENTITIES];
    if (
      !action ||
      !bytes32(action.transactionHash) ||
      !bytes32(action.inputHash) ||
      !bytes32(action.blockHash) ||
      !blockNumber(action.blockNumber) ||
      decimalBigInt(action.blockTimestamp, { positive: true }) === null ||
      !nonNegativeSafeInteger(action.transactionIndex) ||
      !nonNegativeSafeInteger(action.nonce) ||
      decimalBigInt(action.value) === null ||
      !Number.isSafeInteger(action.confirmations) ||
      Number(action.confirmations) < 12 ||
      action.success !== true ||
      Number(action.blockNumber) <= previousBlock ||
      Number(action.blockNumber) > Number(lifecycle.verificationBlock) ||
      Number(action.confirmations) !==
        Number(lifecycle.verificationBlock) - Number(action.blockNumber) + 1 ||
      !validEventIndices(action.events, ACTION_EVENT_KEYS[actionName])
    ) {
      return false;
    }
    const transactionHash = String(action.transactionHash).toLowerCase();
    if (transactionHashes.has(transactionHash)) return false;
    transactionHashes.add(transactionHash);
    previousBlock = Number(action.blockNumber);
    if (actionName !== "launcherClaim") {
      if (Number(action.nonce) <= previousOperatorNonce) return false;
      previousOperatorNonce = Number(action.nonce);
    }
    const expectedFrom =
      actionName === "launcherClaim"
        ? addresses.launcherFeeRecipient
        : lifecycle.operatorWallet;
    const expectedTo =
      actionName === "launch"
        ? CLASSIC_V4_LAUNCH_STAMP_ROUTER
        : swapIdentity
          ? universalRouter
          : actionName === "creatorClaim"
            ? lifecycle.rewardVault
            : addresses.feeHook;
    if (
      !sameAddressValue(action.from, expectedFrom) ||
      !sameAddressValue(action.to, expectedTo) ||
      (swapIdentity &&
        (action.side !== swapIdentity[0] ||
          action.exactness !== swapIdentity[1]))
    ) {
      return false;
    }
  }
  const launcherClaimAction = record(actions.launcherClaim)!;
  if (
    lifecycle.latestLifecycleBlock !== launcherClaimAction.blockNumber ||
    Number(lifecycle.confirmations) !==
      Number(lifecycle.verificationBlock) -
        Number(lifecycle.latestLifecycleBlock) +
        1
  ) {
    return false;
  }

  if (
    !validClassicV4RouterAuthorization({
      lifecycle,
      addresses,
      runtimeCodeHashes,
    })
  ) {
    return false;
  }

  const swaps = record(lifecycle.swaps);
  if (!swaps) return false;
  let swapCreatorTotal = 0n;
  let swapLauncherTotal = 0n;
  for (const [actionName, [side, exactness]] of Object.entries(
    SWAP_IDENTITIES,
  )) {
    const swap = record(swaps[actionName]);
    const action = record(actions[actionName])!;
    const quote = swap && record(swap.quote);
    const amount0 = swap && decimalBigInt(swap.poolAmount0, { signed: true });
    const amount1 = swap && decimalBigInt(swap.poolAmount1, { signed: true });
    const gross =
      swap && decimalBigInt(swap.grossNativeAmount, { positive: true });
    const creatorFee =
      swap && decimalBigInt(swap.creatorFee, { positive: true });
    const launcherFee =
      swap && decimalBigInt(swap.launcherFee, { positive: true });
    const totalFee = swap && decimalBigInt(swap.totalFee, { positive: true });
    const inputBound =
      swap && decimalBigInt(swap.inputBound, { positive: true });
    const outputBound =
      swap && decimalBigInt(swap.outputBound, { positive: true });
    const deadline =
      swap && decimalBigInt(swap.routerDeadline, { positive: true });
    const blockTimestamp = decimalBigInt(action.blockTimestamp, {
      positive: true,
    });
    if (
      !swap ||
      !quote ||
      amount0 === null ||
      amount1 === null ||
      gross === null ||
      creatorFee === null ||
      launcherFee === null ||
      totalFee === null ||
      inputBound === null ||
      outputBound === null ||
      deadline === null ||
      blockTimestamp === null ||
      swap.side !== side ||
      swap.exactness !== exactness ||
      swap.executionPath !== "single-hop-all" ||
      swap.appliedTotalSwapFeeBps !== (side === "buy" ? 100 : 200) ||
      creatorFee + launcherFee !== totalFee ||
      deadline < blockTimestamp ||
      deadline > blockTimestamp + 300n ||
      (side === "buy"
        ? !(amount0 < 0n && amount1 > 0n && -amount0 + totalFee === gross)
        : !(amount0 > 0n && amount1 < 0n && amount0 === gross))
    ) {
      return false;
    }
    const expectedFee =
      exactness === "exact-output"
        ? netFeeSplit(
            side === "buy" ? -amount0 : outputBound,
            side === "buy" ? 100 : 200,
          )
        : grossFeeSplit(
            side === "buy" ? inputBound : amount0,
            side === "buy" ? 100 : 200,
          );
    if (
      creatorFee !== expectedFee.creator ||
      launcherFee !== expectedFee.launcher ||
      totalFee !== expectedFee.total ||
      (side === "buy" && exactness === "exact-input"
        ? !(gross === inputBound && amount1 >= outputBound)
        : side === "buy" && exactness === "exact-output"
          ? !(amount1 === outputBound && gross <= inputBound)
          : side === "sell" && exactness === "exact-input"
            ? !(-amount1 === inputBound && amount0 - totalFee >= outputBound)
            : !(amount0 - totalFee === outputBound && -amount1 <= inputBound))
    ) {
      return false;
    }
    const quotedAmount = decimalBigInt(quote.quotedAmount, { positive: true });
    const gasEstimate = decimalBigInt(quote.gasEstimate, { positive: true });
    const quoteBound = decimalBigInt(quote.bound, { positive: true });
    const exactAmount = decimalBigInt(quote.exactAmount, { positive: true });
    const exactInput = exactness === "exact-input";
    if (
      quotedAmount === null ||
      gasEstimate === null ||
      quoteBound === null ||
      exactAmount === null ||
      !bytes32(quote.blockHash) ||
      quote.policy !== "canonical-v4-quoter-at-parent-block" ||
      quote.function !==
        `V4Quoter.${exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"}` ||
      quote.blockNumber !== Number(action.blockNumber) - 1 ||
      quote.slippageBps !== 100 ||
      exactAmount !==
        SWAP_EXACT_AMOUNTS[actionName as keyof typeof SWAP_EXACT_AMOUNTS] ||
      exactAmount !== (exactInput ? inputBound : outputBound) ||
      quoteBound !==
        (exactInput
          ? (quotedAmount * 9_900n) / 10_000n
          : (quotedAmount * 10_100n + 9_999n) / 10_000n) ||
      quoteBound !== (exactInput ? outputBound : inputBound) ||
      decimalBigInt(action.value) !== (side === "buy" ? inputBound : 0n)
    ) {
      return false;
    }
    swapCreatorTotal += creatorFee;
    swapLauncherTotal += launcherFee;
  }
  if (
    decimalBigInt(record(actions.launch)?.value) !==
      CLASSIC_V4_CANARY_INITIAL_BUY ||
    decimalBigInt(record(actions.creatorClaim)?.value) !== 0n ||
    decimalBigInt(record(actions.launcherClaim)?.value) !== 0n
  ) {
    return false;
  }

  const claims = record(lifecycle.claims);
  const creatorClaim = claims && record(claims.creator);
  const launcherClaim = claims && record(claims.launcher);
  const creatorAmount =
    creatorClaim && decimalBigInt(creatorClaim.amount, { positive: true });
  const creatorCheckpoint =
    creatorClaim &&
    decimalBigInt(creatorClaim.vaultCheckpointAmount, { positive: true });
  const beneficiaryAmount =
    creatorClaim &&
    decimalBigInt(creatorClaim.beneficiaryAmount, { positive: true });
  const launcherAmount =
    launcherClaim && decimalBigInt(launcherClaim.amount, { positive: true });
  const initialFee = grossFeeSplit(CLASSIC_V4_CANARY_INITIAL_BUY, 100);
  if (
    creatorAmount === null ||
    creatorAmount === undefined ||
    creatorCheckpoint !== creatorAmount ||
    beneficiaryAmount !== creatorAmount ||
    launcherAmount === null ||
    launcherAmount === undefined ||
    creatorAmount !== swapCreatorTotal + initialFee.creator ||
    launcherAmount !== swapLauncherTotal + initialFee.launcher
  ) {
    return false;
  }

  const feeConservation = record(lifecycle.feeConservation);
  const checkpoints = feeConservation && record(feeConservation.checkpoints);
  const creatorTotal =
    feeConservation &&
    decimalBigInt(feeConservation.creatorAccrualTotal, { positive: true });
  const launcherTotal =
    feeConservation &&
    decimalBigInt(feeConservation.launcherAccrualTotal, { positive: true });
  const totalAccrual =
    feeConservation &&
    decimalBigInt(feeConservation.totalAccrual, { positive: true });
  if (
    !checkpoints ||
    creatorTotal !== creatorAmount ||
    launcherTotal !== launcherAmount ||
    totalAccrual !== creatorAmount + launcherAmount
  ) {
    return false;
  }
  const expectedCheckpointBlocks = {
    preLaunch: Number(record(actions.launch)?.blockNumber) - 1,
    beforeCreatorClaim: Number(record(actions.creatorClaim)?.blockNumber) - 1,
    afterCreatorClaim: Number(record(actions.creatorClaim)?.blockNumber),
    beforeLauncherClaim: Number(record(actions.launcherClaim)?.blockNumber) - 1,
    final: Number(lifecycle.verificationBlock),
  };
  const validHookState = (
    value: unknown,
    state: { registered: boolean; creator: bigint; launcher: bigint },
  ) => {
    const hook = record(value);
    const total = state.creator + state.launcher;
    return Boolean(
      hook &&
      sameAddressValue(
        hook.rewardVault,
        state.registered ? lifecycle.rewardVault : ZERO_ADDRESS,
      ) &&
      sameAddressValue(
        hook.registrar,
        state.registered ? lifecycle.launcher : ZERO_ADDRESS,
      ) &&
      hook.registered === state.registered &&
      hook.buySwapFeeBps === (state.registered ? 100 : 0) &&
      hook.sellSwapFeeBps === (state.registered ? 200 : 0) &&
      decimalBigInt(hook.creatorFeesAccrued) === state.creator &&
      decimalBigInt(hook.launcherFeesAccrued) === state.launcher &&
      decimalBigInt(hook.totalNativeFeesAccrued) === total &&
      decimalBigInt(hook.poolManagerNativeClaims) === total &&
      decimalBigInt(hook.poolManagerTokenClaims) === 0n &&
      decimalBigInt(hook.rawNativeBalance) === 0n,
    );
  };
  const validVaultState = (value: unknown, expected: bigint) => {
    const vault = record(value);
    return Boolean(
      vault &&
      decimalBigInt(vault.totalCreatorFeesReceived) === expected &&
      decimalBigInt(vault.totalCreatorFeesClaimed) === expected &&
      decimalBigInt(vault.beneficiaryClaimed) === expected &&
      decimalBigInt(vault.beneficiaryClaimable) === 0n &&
      decimalBigInt(vault.rawNativeBalance) === 0n,
    );
  };
  const checkpointStates = {
    preLaunch: { registered: false, creator: 0n, launcher: 0n },
    beforeCreatorClaim: {
      registered: true,
      creator: creatorAmount,
      launcher: launcherAmount,
    },
    afterCreatorClaim: {
      registered: true,
      creator: 0n,
      launcher: launcherAmount,
    },
    beforeLauncherClaim: {
      registered: true,
      creator: 0n,
      launcher: launcherAmount,
    },
    final: { registered: true, creator: 0n, launcher: 0n },
  };
  for (const [name, state] of Object.entries(checkpointStates)) {
    const checkpoint = record(checkpoints[name]);
    if (
      !checkpoint ||
      checkpoint.blockNumber !==
        expectedCheckpointBlocks[
          name as keyof typeof expectedCheckpointBlocks
        ] ||
      !validHookState(checkpoint.hook, state)
    ) {
      return false;
    }
    if (
      name === "beforeCreatorClaim" &&
      !validVaultState(checkpoint.vault, 0n)
    ) {
      return false;
    }
    if (
      (name === "afterCreatorClaim" || name === "final") &&
      !validVaultState(checkpoint.vault, creatorAmount)
    ) {
      return false;
    }
  }

  const postState = record(lifecycle.postState);
  const launchMappings = postState && record(postState.launchMappings);
  const poolFeeConfig = postState && record(postState.poolFeeConfig);
  const rewardVault = postState && record(postState.rewardVault);
  const positionLock = postState && record(postState.positionLock);
  const tokenCustody = postState && record(postState.tokenCustody);
  const derivedCodeHashes = postState && record(postState.derivedCodeHashes);
  const positionManager = record(official.positionManager)?.address;
  if (
    !launchMappings ||
    !poolFeeConfig ||
    !rewardVault ||
    !positionLock ||
    !tokenCustody ||
    !derivedCodeHashes ||
    !bytes32(launchMappings.launchHash) ||
    !sameAddressValue(launchMappings.rewardVault, lifecycle.rewardVault) ||
    !sameAddressValue(launchMappings.initialBuyCustody, ZERO_ADDRESS) ||
    !sameAddressValue(poolFeeConfig.rewardVault, lifecycle.rewardVault) ||
    !sameAddressValue(poolFeeConfig.registrar, lifecycle.launcher) ||
    poolFeeConfig.buySwapFeeBps !== 100 ||
    poolFeeConfig.sellSwapFeeBps !== 200 ||
    poolFeeConfig.registered !== true ||
    decimalBigInt(poolFeeConfig.creatorFeesAccrued) !== 0n ||
    !bytes32(rewardVault.configurationHash) ||
    !bytes32(rewardVault.activeConfigurationHash) ||
    rewardVault.configurationEpoch !== 1 ||
    rewardVault.shareBps !== 10_000 ||
    !sameAddressValue(rewardVault.beneficiary, lifecycle.operatorWallet) ||
    !sameAddressValue(positionLock.owner, lifecycle.positionRecipient) ||
    !sameAddressValue(positionLock.approved, ZERO_ADDRESS) ||
    !sameAddressValue(positionLock.manager, positionManager) ||
    !sameAddressValue(positionLock.operator, ZERO_ADDRESS) ||
    !sameAddressValue(positionLock.feeRecipient, lifecycle.operatorWallet) ||
    !bytes32(positionLock.factoryConfigurationHash) ||
    decimalBigInt(positionLock.tokenId, { positive: true }) !==
      decimalBigInt(lifecycle.positionTokenId, { positive: true }) ||
    decimalBigInt(positionLock.positionLiquidity, { positive: true }) ===
      null ||
    decimalBigInt(positionLock.activePoolLiquidity, { positive: true }) ===
      null ||
    positionLock.tickLower !== 174_800 ||
    positionLock.tickUpper !== 204_200 ||
    decimalBigInt(positionLock.timelockBlockNumber, { positive: true }) !==
      UINT256_MAX ||
    decimalBigInt(tokenCustody.totalSupply, { positive: true }) !==
      CLASSIC_TOKEN_SUPPLY ||
    decimalBigInt(tokenCustody.lockedTokenDust) === null ||
    decimalBigInt(tokenCustody.launcherBalance) !== 0n ||
    decimalBigInt(tokenCustody.positionManagerBalance) !== 0n ||
    !bytes32(derivedCodeHashes.token) ||
    !bytes32(derivedCodeHashes.rewardVault) ||
    !bytes32(derivedCodeHashes.positionForwarder) ||
    typeof derivedCodeHashes.rewardVaultPredeployed !== "boolean" ||
    typeof derivedCodeHashes.positionForwarderPredeployed !== "boolean"
  ) {
    return false;
  }

  const observations = record(lifecycle.observations);
  const exclusive = observations && record(observations.exclusiveHookActivity);
  const approvals = observations && record(observations.sellApprovals);
  if (
    !exclusive ||
    !approvals ||
    exclusive.fromBlock !== record(actions.launch)?.blockNumber ||
    exclusive.toBlock !== lifecycle.verificationBlock ||
    exclusive.nativeAccrualEvents !== 5 ||
    exclusive.creatorClaimEvents !== 1 ||
    exclusive.launcherClaimEvents !== 1
  ) {
    return false;
  }
  for (const actionName of ["sellExactInput", "sellExactOutput"] as const) {
    const approval = record(approvals[actionName]);
    const action = record(actions[actionName])!;
    const swap = record(swaps[actionName])!;
    const required =
      approval && decimalBigInt(approval.requiredAmount, { positive: true });
    if (
      !approval ||
      required === null ||
      required === undefined ||
      approval.blockNumber !== Number(action.blockNumber) - 1 ||
      required !== decimalBigInt(swap.inputBound, { positive: true }) ||
      (decimalBigInt(approval.erc20AllowanceToPermit2) ?? -1n) < required ||
      (decimalBigInt(approval.permit2AllowanceToRouter) ?? -1n) < required ||
      (decimalBigInt(approval.permit2Expiration) ?? -1n) <
        (decimalBigInt(action.blockTimestamp, { positive: true }) ?? 0n) ||
      decimalBigInt(approval.permit2Nonce) === null
    ) {
      return false;
    }
  }
  const invariants = record(lifecycle.invariants);
  return Boolean(
    invariants && LIFECYCLE_INVARIANTS.every((key) => invariants[key] === true),
  );
}

/**
 * Accepts only a release that is safe for the public launch preflight.
 * Source-only, deployed-only, lifecycle-only and indexer-pending manifests
 * deliberately return null. Browser/publication proof may follow later.
 */
function parseClassicV4Release(
  value: unknown,
  mode: "pending" | "public",
  trustedBinding?: ClassicV4PublicReleaseBinding | null,
): ClassicV4PendingRelease | ClassicV4PublicRelease | null {
  if (!validateClassicV4ReleaseSchema(value)) return null;
  const manifest = exactKeys(value, [
    "schemaVersion",
    "model",
    "internalContractRelease",
    "releaseStatus",
    "chainId",
    "releaseCommit",
    "releaseTree",
    "sourceCommitment",
    "planDigest",
    "capturedAt",
    "startBlock",
    "addresses",
    "deploymentTransactions",
    "deploymentBlocks",
    "deploymentVerification",
    "runtimeCodeHashes",
    "runtimeTemplateHashes",
    "officialDependencies",
    "sharedDependencies",
    "verification",
    "sourceVerification",
    "lifecycleEvidence",
    "indexerHandoff",
    "manifestDigest",
  ]);
  if (!manifest) return null;
  const pending =
    manifest.releaseStatus === "deployment-source-and-lifecycle-verified";
  const verification = exactKeys(manifest.verification, [
    "deploymentLive",
    "deploymentFinalized",
    "independentRpcCount",
    "runtimeCodeVerified",
    "constructorBindingsVerified",
    "sourceVerified",
    "lifecycleVerified",
    "indexerActivated",
    "publicAvailable",
  ]);
  const validReleaseState = pending
    ? mode === "pending" &&
      verification?.indexerActivated === false &&
      verification.publicAvailable === false
    : mode === "public" &&
      verification?.indexerActivated === true &&
      ((manifest.releaseStatus === "indexer-activated" &&
        verification.publicAvailable === false) ||
        (manifest.releaseStatus === "publicly-available" &&
          verification.publicAvailable === true));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.model !== "classic" ||
    manifest.internalContractRelease !== "classic-v4" ||
    !validReleaseState ||
    manifest.chainId !== 1 ||
    !commit(manifest.releaseCommit) ||
    !commit(manifest.releaseTree) ||
    !bytes32(manifest.sourceCommitment) ||
    !bytes32(manifest.planDigest) ||
    !bytes32(manifest.manifestDigest) ||
    !blockNumber(manifest.startBlock) ||
    !strictIsoDateTime(manifest.capturedAt) ||
    !verification ||
    verification.deploymentLive !== true ||
    verification.deploymentFinalized !== true ||
    !Number.isSafeInteger(verification.independentRpcCount) ||
    Number(verification.independentRpcCount) < 2 ||
    verification.runtimeCodeVerified !== true ||
    verification.constructorBindingsVerified !== true ||
    verification.sourceVerified !== true ||
    verification.lifecycleVerified !== true
  ) {
    return null;
  }

  const addressKeys = [
    "deployer",
    "launcherFeeRecipient",
    ...SHARED_CONTRACTS,
    ...NEW_CONTRACTS,
  ];
  const addresses = exactKeys(manifest.addresses, addressKeys);
  const runtimeCodeHashes = exactKeys(manifest.runtimeCodeHashes, [
    ...SHARED_CONTRACTS,
    ...NEW_CONTRACTS,
  ]);
  const deploymentTransactions = exactKeys(
    manifest.deploymentTransactions,
    NEW_CONTRACTS,
  );
  const deploymentBlocks = exactKeys(manifest.deploymentBlocks, NEW_CONTRACTS);
  const deploymentVerification = exactKeys(manifest.deploymentVerification, [
    "evidenceDigest",
    "checkedAt",
    "verificationBlock",
    "verificationBlockHash",
    "contractBlockHashes",
    "confirmations",
  ]);
  const contractBlockHashes =
    deploymentVerification &&
    exactKeys(deploymentVerification.contractBlockHashes, NEW_CONTRACTS);
  const deploymentConfirmations =
    deploymentVerification &&
    exactKeys(deploymentVerification.confirmations, NEW_CONTRACTS);
  const runtimeTemplateHashes = exactKeys(
    manifest.runtimeTemplateHashes,
    NEW_CONTRACTS,
  );
  if (
    !addresses ||
    !addressKeys.every((key) => address(addresses[key])) ||
    !runtimeCodeHashes ||
    ![...SHARED_CONTRACTS, ...NEW_CONTRACTS].every((key) =>
      bytes32(runtimeCodeHashes[key]),
    ) ||
    !deploymentTransactions ||
    !NEW_CONTRACTS.every((key) => bytes32(deploymentTransactions[key])) ||
    !deploymentBlocks ||
    !NEW_CONTRACTS.every((key) => blockNumber(deploymentBlocks[key])) ||
    Math.min(...NEW_CONTRACTS.map((key) => Number(deploymentBlocks[key]))) !==
      manifest.startBlock ||
    !deploymentVerification ||
    !bytes32(deploymentVerification.evidenceDigest) ||
    !strictIsoDateTime(deploymentVerification.checkedAt) ||
    !blockNumber(deploymentVerification.verificationBlock) ||
    !bytes32(deploymentVerification.verificationBlockHash) ||
    !contractBlockHashes ||
    !NEW_CONTRACTS.every((key) => bytes32(contractBlockHashes[key])) ||
    !deploymentConfirmations ||
    !NEW_CONTRACTS.every((key) => {
      const deploymentBlock = Number(deploymentBlocks[key]);
      const verificationBlock = Number(
        deploymentVerification.verificationBlock,
      );
      const confirmations = deploymentConfirmations[key];
      return (
        deploymentBlock <= verificationBlock &&
        Number.isSafeInteger(confirmations) &&
        Number(confirmations) >= 12 &&
        Number(confirmations) === verificationBlock - deploymentBlock + 1
      );
    }) ||
    !runtimeTemplateHashes ||
    !NEW_CONTRACTS.every((key) => bytes32(runtimeTemplateHashes[key])) ||
    !validAddressRuntimeMap(
      manifest.officialDependencies,
      OFFICIAL_DEPENDENCIES,
    ) ||
    !validAddressRuntimeMap(manifest.sharedDependencies, SHARED_CONTRACTS)
  ) {
    return null;
  }

  const official = record(manifest.officialDependencies)!;
  const shared = record(manifest.sharedDependencies)!;
  if (
    !SHARED_CONTRACTS.every((key) => {
      const dependency = record(shared[key]);
      return (
        dependency &&
        String(dependency.address).toLowerCase() ===
          String(addresses[key]).toLowerCase() &&
        String(dependency.runtimeCodeHash).toLowerCase() ===
          String(runtimeCodeHashes[key]).toLowerCase()
      );
    }) ||
    !OFFICIAL_DEPENDENCIES.every((key) => {
      const dependency = record(official[key]);
      const [expectedAddress, expectedHash] =
        EXPECTED_OFFICIAL_DEPENDENCIES[key];
      return (
        dependency &&
        String(dependency.address).toLowerCase() ===
          expectedAddress.toLowerCase() &&
        String(dependency.runtimeCodeHash).toLowerCase() ===
          expectedHash.toLowerCase()
      );
    }) ||
    String(addresses.launcherFeeRecipient).toLowerCase() !==
      "0x4957f49620aff3adbbe8195a4f633e49cc93376c" ||
    String(addresses.deployer).toLowerCase() ===
      String(addresses.launcherFeeRecipient).toLowerCase()
  ) {
    return null;
  }

  const source = exactKeys(manifest.sourceVerification, [
    "schemaVersion",
    "chainId",
    "planDigest",
    "sourceCommitment",
    "status",
    "checkedAt",
    "contracts",
    "evidenceDigest",
  ]);
  const sourceContracts = source && exactKeys(source.contracts, NEW_CONTRACTS);
  if (
    source?.schemaVersion !== 1 ||
    source.chainId !== 1 ||
    String(source.planDigest).toLowerCase() !==
      String(manifest.planDigest).toLowerCase() ||
    String(source.sourceCommitment).toLowerCase() !==
      String(manifest.sourceCommitment).toLowerCase() ||
    source.status !== "verified" ||
    !strictIsoDateTime(source.checkedAt) ||
    !bytes32(source.evidenceDigest) ||
    String(source.evidenceDigest).toLowerCase() !==
      evidenceDigest(
        source,
        CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
      ).toLowerCase() ||
    !sourceContracts
  ) {
    return null;
  }
  for (const name of NEW_CONTRACTS) {
    const contract = exactKeys(sourceContracts[name], [
      "address",
      "contractName",
      "fqcn",
      "encodedConstructorArguments",
      "deploymentTransaction",
      "deploymentBlock",
      "status",
      "providers",
    ]);
    if (
      !contract ||
      typeof contract.contractName !== "string" ||
      contract.contractName.length === 0 ||
      typeof contract.fqcn !== "string" ||
      contract.fqcn.length === 0 ||
      typeof contract.encodedConstructorArguments !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(contract.encodedConstructorArguments) ||
      !["match", "exact-match"].includes(String(contract.status)) ||
      String(contract.address).toLowerCase() !==
        String(addresses[name]).toLowerCase() ||
      String(contract.deploymentTransaction).toLowerCase() !==
        String(deploymentTransactions[name]).toLowerCase() ||
      contract.deploymentBlock !== deploymentBlocks[name] ||
      !Array.isArray(contract.providers) ||
      contract.providers.length < 1 ||
      contract.status !== record(contract.providers[0])?.status ||
      !contract.providers.every((value) => {
        const provider = exactKeys(value, ["name", "status", "url"]);
        if (
          !provider ||
          typeof provider.name !== "string" ||
          provider.name.length === 0 ||
          !["match", "exact-match"].includes(String(provider.status)) ||
          typeof provider.url !== "string"
        ) {
          return false;
        }
        try {
          new URL(provider.url);
          return true;
        } catch {
          return false;
        }
      })
    ) {
      return null;
    }
  }

  const lifecycle = record(manifest.lifecycleEvidence);
  if (
    !lifecycle ||
    !validRichLifecycleEvidence({
      lifecycle,
      manifest,
      addresses,
      runtimeCodeHashes,
      official,
      deploymentBlocks,
      deploymentVerification,
      source,
    })
  ) {
    return null;
  }

  const handoff = exactKeys(manifest.indexerHandoff, [
    "schemaVersion",
    "chainId",
    "model",
    "releaseVersion",
    "releaseCommit",
    "sourceCommitment",
    "startBlock",
    "sources",
    "sourceVerified",
    "lifecycleVerified",
    "activationEligible",
    "indexerBindingDigest",
    "activated",
  ]);
  const sources =
    handoff && exactKeys(handoff.sources, ["launcher", "feeHook"]);
  const launcherSource =
    sources && exactKeys(sources.launcher, ["address", "startBlock", "events"]);
  const hookSource =
    sources && exactKeys(sources.feeHook, ["address", "startBlock", "events"]);
  const validHandoffActivation = pending
    ? handoff?.indexerBindingDigest === null && handoff.activated === false
    : Boolean(bytes32(handoff?.indexerBindingDigest)) &&
      handoff?.activated === true;
  if (
    handoff?.schemaVersion !== 1 ||
    handoff.chainId !== 1 ||
    handoff.model !== "classic" ||
    handoff.releaseVersion !== "classic-v4" ||
    String(handoff.releaseCommit).toLowerCase() !==
      String(manifest.releaseCommit).toLowerCase() ||
    String(handoff.sourceCommitment).toLowerCase() !==
      String(manifest.sourceCommitment).toLowerCase() ||
    handoff.startBlock !== manifest.startBlock ||
    handoff.sourceVerified !== true ||
    handoff.lifecycleVerified !== true ||
    handoff.activationEligible !== true ||
    !validHandoffActivation ||
    !launcherSource ||
    !hookSource ||
    String(launcherSource.address).toLowerCase() !==
      String(addresses.launcher).toLowerCase() ||
    String(hookSource.address).toLowerCase() !==
      String(addresses.feeHook).toLowerCase() ||
    launcherSource.startBlock !== deploymentBlocks.launcher ||
    hookSource.startBlock !== deploymentBlocks.feeHook ||
    !Array.isArray(launcherSource.events) ||
    !launcherSource.events.includes("MemeTokenLaunchedV2") ||
    !Array.isArray(hookSource.events) ||
    !hookSource.events.includes("PoolRegistered") ||
    !hookSource.events.includes("NativeSwapFeesAccrued") ||
    String(manifest.manifestDigest).toLowerCase() !==
      manifestDigest(manifest).toLowerCase()
  ) {
    return null;
  }

  if (mode === "public") {
    const launchAnchor = validClassicV4RouterAuthorization({
      lifecycle,
      addresses,
      runtimeCodeHashes,
    });
    if (
      !launchAnchor ||
      !matchesClassicV4PublicReleaseBinding({
        binding: trustedBinding,
        manifest,
        addresses,
        verification,
        launchAnchor,
      })
    ) {
      return null;
    }
  }

  return manifest as ClassicV4PendingRelease | ClassicV4PublicRelease;
}

/**
 * Parses the exact pre-activation release state using the same schema and
 * semantic checks as the public runtime parser.
 */
export function parseClassicV4PendingRelease(
  value: unknown,
): ClassicV4PendingRelease | null {
  return parseClassicV4Release(
    value,
    "pending",
  ) as ClassicV4PendingRelease | null;
}

export function parseClassicV4PublicRelease(
  value: unknown,
  trustedBinding: ClassicV4PublicReleaseBinding | null,
): ClassicV4PublicRelease | null {
  return parseClassicV4Release(
    value,
    "public",
    trustedBinding,
  ) as ClassicV4PublicRelease | null;
}

export type ClassicV4PublicPromotion = Readonly<{
  release: ClassicV4PublicActionRelease;
  browserBinding: ClassicV4PublicReleaseBinding & {
    releaseStatus: "publicly-available";
    publicAvailable: true;
  } & ClassicV4FinalizedLaunchAnchor;
}>;

/**
 * Pure, fail-closed transition from the catalog-visible indexer state to the
 * public wallet-action state. The input must match the code-reviewed indexer
 * binding; the output preserves its finalized launch anchor while binding the
 * newly digested public manifest.
 */
export function promoteClassicV4ReleaseToPublicAvailability(
  value: unknown,
  trustedIndexerBinding: ClassicV4PublicReleaseBinding | null,
): ClassicV4PublicPromotion | null {
  const indexedRelease = parseClassicV4PublicRelease(
    value,
    trustedIndexerBinding,
  );
  if (
    !indexedRelease ||
    indexedRelease.releaseStatus !== "indexer-activated" ||
    indexedRelease.verification.publicAvailable !== false
  ) {
    return null;
  }
  const launchAnchor = deriveClassicV4FinalizedLaunchAnchor(indexedRelease);
  if (!launchAnchor) return null;

  const promotedWithoutDigest = {
    ...indexedRelease,
    releaseStatus: "publicly-available" as const,
    verification: {
      ...indexedRelease.verification,
      publicAvailable: true as const,
    },
  };
  const promoted = {
    ...promotedWithoutDigest,
    manifestDigest: manifestDigest(
      promotedWithoutDigest as unknown as Record<string, unknown>,
    ),
  };
  const browserBinding = Object.freeze({
    chainId: indexedRelease.chainId,
    launcher: indexedRelease.addresses.launcher,
    manifestDigest: promoted.manifestDigest,
    releaseStatus: "publicly-available" as const,
    publicAvailable: true as const,
    ...launchAnchor,
  });
  const release = parseClassicV4PublicRelease(promoted, browserBinding);
  if (!isClassicV4PublicActionRelease(release)) return null;

  return {
    release,
    browserBinding,
  };
}

export function getConfiguredClassicV4PublicRelease(
  environment: "production" | "rehearsal",
) {
  if (
    environment !== "production" ||
    !isClassicV4AnchoredPublicReleaseBinding(CLASSIC_V4_PUBLIC_RELEASE_BINDING)
  ) {
    return null;
  }
  try {
    const raw = readFileSync(
      path.join(process.cwd(), CLASSIC_V4_RELEASE_MANIFEST_PATH),
      "utf8",
    );
    return parseClassicV4PublicRelease(
      JSON.parse(raw),
      CLASSIC_V4_PUBLIC_RELEASE_BINDING,
    );
  } catch {
    return null;
  }
}
