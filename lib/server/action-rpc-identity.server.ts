import "server-only";

import {
  getAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "../classic-v3-release";
import {
  memeTokenLaunchedEvent,
  uerc20ReadAbi,
} from "../onchain/abis";
import { getOnchainDeployment } from "../onchain/config";
import type { ExploreReadModel, ReadyOnchainDeployment } from "../onchain/types";
import {
  getConfiguredStockPairedReleases,
  type VerifiedStockPairedRelease,
} from "../stock-paired-release";
import type { LauncherToken } from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const CREATOR_CLAIM_LOG_RANGE = 10_000n;

const classicLauncherStateAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function poolKey(address token) view returns (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
]);

const stockLauncherStateAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function quoteAssetOf(address token) view returns (address)",
  "function rewardVaultOf(address token) view returns (address)",
  "function poolKey(address token,address quoteAsset) view returns (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
]);

type ClassicPoolKeyState = readonly [Address, Address, number, number, Address];

type ActionRelease =
  | Readonly<{
      kind: "classic-v2" | "classic-v3";
      launcher: Address;
      hook: Address;
      launcherRuntimeCodeHash: Hex;
      hookRuntimeCodeHash: Hex;
    }>
  | Readonly<{
      kind: "stock-paired";
      launcher: Address;
      hook: Address;
      launcherRuntimeCodeHash: Hex;
      hookRuntimeCodeHash: Hex;
      release: VerifiedStockPairedRelease;
    }>;

export class ActionRpcIdentityError extends Error {
  readonly code:
    | "unknown-token"
    | "unknown-pool"
    | "ambiguous-identity"
    | "identity-mismatch"
    | "runtime-mismatch";

  constructor(code: ActionRpcIdentityError["code"], message: string) {
    super(message);
    this.name = "ActionRpcIdentityError";
    this.code = code;
  }

  toJSON() {
    return { name: this.name, code: this.code };
  }
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function productionClassicV2Release(): ActionRelease {
  const deployment = getOnchainDeployment("production");
  if (deployment.status !== "ready" || deployment.chainId !== 1) {
    throw new ActionRpcIdentityError(
      "identity-mismatch",
      "The canonical Classic release is not configured",
    );
  }
  return {
    kind: "classic-v2",
    launcher: deployment.launcher,
    hook: deployment.feeHook,
    launcherRuntimeCodeHash: deployment.launcherRuntimeCodeHash,
    hookRuntimeCodeHash: deployment.feeHookRuntimeCodeHash,
  };
}

function productionClassicV3Release(): ActionRelease {
  const { appManifest, releaseManifest } =
    getConfiguredClassicV3Release("production");
  if (
    !isClassicV3ReleaseVerified(appManifest, releaseManifest, 1) ||
    typeof appManifest.memeLaunchV2 !== "string" ||
    typeof appManifest.ethCreatorFeeHookV3 !== "string" ||
    typeof appManifest.runtimeCodeHashes?.memeLaunchV2 !== "string" ||
    typeof appManifest.runtimeCodeHashes.ethCreatorFeeHookV3 !== "string"
  ) {
    throw new ActionRpcIdentityError(
      "identity-mismatch",
      "The canonical Classic V3 release is not configured",
    );
  }
  return {
    kind: "classic-v3",
    launcher: getAddress(appManifest.memeLaunchV2),
    hook: getAddress(appManifest.ethCreatorFeeHookV3),
    launcherRuntimeCodeHash: appManifest.runtimeCodeHashes.memeLaunchV2 as Hex,
    hookRuntimeCodeHash:
      appManifest.runtimeCodeHashes.ethCreatorFeeHookV3 as Hex,
  };
}

function productionActionReleases(): readonly ActionRelease[] {
  return [
    productionClassicV2Release(),
    productionClassicV3Release(),
    ...getConfiguredStockPairedReleases().map((release) => ({
      kind: "stock-paired" as const,
      launcher: release.addresses.launcher,
      hook: release.addresses.feeHook,
      launcherRuntimeCodeHash: release.runtimeCodeHashes.launcher,
      hookRuntimeCodeHash: release.runtimeCodeHashes.feeHook,
      release,
    })),
  ];
}

async function assertCurrentReleaseRuntime(
  client: PublicClient,
  release: ActionRelease,
  blockNumber: bigint,
) {
  const [launcherCode, hookCode] = await Promise.all([
    client.getCode({ address: release.launcher, blockNumber }),
    client.getCode({ address: release.hook, blockNumber }),
  ]);
  if (
    !launcherCode ||
    launcherCode === "0x" ||
    !sameHex(keccak256(launcherCode), release.launcherRuntimeCodeHash) ||
    !hookCode ||
    hookCode === "0x" ||
    !sameHex(keccak256(hookCode), release.hookRuntimeCodeHash)
  ) {
    throw new ActionRpcIdentityError(
      "runtime-mismatch",
      "The launch release does not match its verified runtime",
    );
  }
}

function canonicalPoolId(
  poolKey: ClassicPoolKeyState,
  token: Address,
  hook: Address,
) {
  const [currency0, currency1, fee, tickSpacing, hooks] = poolKey;
  if (
    !sameHex(currency0, ZERO_ADDRESS) ||
    !sameHex(currency1, token) ||
    fee !== 0 ||
    tickSpacing !== 200 ||
    !sameHex(hooks, hook)
  ) {
    throw new ActionRpcIdentityError(
      "identity-mismatch",
      "The token does not match the canonical launch pool",
    );
  }
  return computeOfficialV4PoolId({
    currency0: getAddress(currency0),
    currency1: getAddress(currency1),
    fee,
    tickSpacing,
    hooks: getAddress(hooks),
  });
}

function actionModel(
  token: LauncherToken,
  blockNumber: bigint,
  blockHash: Hex,
): ExploreReadModel {
  return {
    status: "ready",
    tokens: [token],
    snapshot: {
      chainId: 1,
      blockNumber: blockNumber.toString(),
      blockHash,
      confirmations: 0,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

async function tokenMetadata(
  client: PublicClient,
  token: Address,
  blockNumber: bigint,
) {
  const [name, symbol, creator] = await Promise.all([
    client.readContract({
      address: token,
      abi: uerc20ReadAbi,
      functionName: "name",
      blockNumber,
    }),
    client.readContract({
      address: token,
      abi: uerc20ReadAbi,
      functionName: "symbol",
      blockNumber,
    }),
    client.readContract({
      address: token,
      abi: uerc20ReadAbi,
      functionName: "creator",
      blockNumber,
    }),
  ]);
  return { name, symbol, creator: getAddress(creator) };
}

export async function readTradeActionModelFromRpc(input: {
  client: PublicClient;
  chainId: number;
  token: Address;
  blockNumber: bigint;
  blockHash: Hex;
}): Promise<ExploreReadModel> {
  if (input.chainId !== 1) {
    throw new ActionRpcIdentityError(
      "unknown-token",
      "Trading identity is only available on Ethereum mainnet",
    );
  }
  const token = getAddress(input.token);
  const releases = productionActionReleases();
  const launchHashes = await Promise.all(
    releases.map((release) =>
      input.client.readContract({
        address: release.launcher,
        abi: classicLauncherStateAbi,
        functionName: "launchHashOf",
        args: [token],
        blockNumber: input.blockNumber,
      }),
    ),
  );
  const matches = releases.filter(
    (_, index) => !sameHex(launchHashes[index] as Hex, ZERO_HASH),
  );
  if (matches.length === 0) {
    throw new ActionRpcIdentityError(
      "unknown-token",
      "This token is not a verified Programmable launch",
    );
  }
  if (matches.length !== 1) {
    throw new ActionRpcIdentityError(
      "ambiguous-identity",
      "The token matches more than one launch release",
    );
  }
  const release = matches[0];
  const launchHash = launchHashes[releases.indexOf(release)] as Hex;
  await assertCurrentReleaseRuntime(
    input.client,
    release,
    input.blockNumber,
  );
  const metadata = await tokenMetadata(input.client, token, input.blockNumber);

  if (release.kind === "stock-paired") {
    const [quoteAsset, rewardVault] = await Promise.all([
      input.client.readContract({
        address: release.launcher,
        abi: stockLauncherStateAbi,
        functionName: "quoteAssetOf",
        args: [token],
        blockNumber: input.blockNumber,
      }),
      input.client.readContract({
        address: release.launcher,
        abi: stockLauncherStateAbi,
        functionName: "rewardVaultOf",
        args: [token],
        blockNumber: input.blockNumber,
      }),
    ]);
    const canonicalQuote = getAddress(quoteAsset);
    const canonicalVault = getAddress(rewardVault);
    if (
      sameHex(canonicalQuote, ZERO_ADDRESS) ||
      sameHex(canonicalVault, ZERO_ADDRESS)
    ) {
      throw new ActionRpcIdentityError(
        "identity-mismatch",
        "The Stock-Paired launch identity is incomplete",
      );
    }
    const poolKey = (await input.client.readContract({
      address: release.launcher,
      abi: stockLauncherStateAbi,
      functionName: "poolKey",
      args: [token, canonicalQuote],
      blockNumber: input.blockNumber,
    })) as ClassicPoolKeyState;
    const [currency0, currency1, fee, tickSpacing, hooks] = poolKey;
    const expectedCurrency0 =
      BigInt(token) < BigInt(canonicalQuote) ? token : canonicalQuote;
    const expectedCurrency1 =
      BigInt(token) < BigInt(canonicalQuote) ? canonicalQuote : token;
    if (
      !sameHex(currency0, expectedCurrency0) ||
      !sameHex(currency1, expectedCurrency1) ||
      fee !== 0 ||
      tickSpacing !== 200 ||
      !sameHex(hooks, release.hook)
    ) {
      throw new ActionRpcIdentityError(
        "identity-mismatch",
        "The token does not match its Stock-Paired launch pool",
      );
    }
    const poolId = computeOfficialV4PoolId({
      currency0: getAddress(currency0),
      currency1: getAddress(currency1),
      fee,
      tickSpacing,
      hooks: getAddress(hooks),
    });
    return actionModel(
      {
        id: `1:${token}`,
        name: metadata.name,
        symbol: metadata.symbol,
        tokenAddress: token,
        hookAddress: release.hook,
        poolId,
        creatorAddress: metadata.creator,
        launchHash,
        launchedAt: new Date(0).toISOString(),
        totalSwapFeeBps: null,
        quoteAssetAddress: canonicalQuote,
        rewardVaultAddress: canonicalVault,
        launchModel: "stock-paired",
        launchModelVersion: release.release.internalContractRelease,
        liquidityPath: "meme",
      },
      input.blockNumber,
      input.blockHash,
    );
  }

  const poolKey = (await input.client.readContract({
    address: release.launcher,
    abi: classicLauncherStateAbi,
    functionName: "poolKey",
    args: [token],
    blockNumber: input.blockNumber,
  })) as ClassicPoolKeyState;
  const poolId = canonicalPoolId(poolKey, token, release.hook);
  return actionModel(
    {
      id: `1:${token}`,
      name: metadata.name,
      symbol: metadata.symbol,
      tokenAddress: token,
      hookAddress: release.hook,
      poolId,
      creatorAddress: metadata.creator,
      launchHash,
      launchedAt: new Date(0).toISOString(),
      totalSwapFeeBps: null,
      launchModel: "classic",
      ...(release.kind === "classic-v3"
        ? { launchModelVersion: "classic-v3" as const }
        : {}),
      liquidityPath: "meme",
    },
    input.blockNumber,
    input.blockHash,
  );
}

export type CreatorClaimTokenIdentity = Readonly<{
  tokenAddress: Address;
  hookAddress: Address;
  poolId: Hex;
  creatorAddress: Address;
  totalSwapFeeBps: number;
}>;

export async function readCreatorClaimIdentityFromRpc(input: {
  client: PublicClient;
  deployment: ReadyOnchainDeployment;
  poolId: Hex;
  blockNumber: bigint;
}): Promise<CreatorClaimTokenIdentity> {
  const logs = [];
  for (
    let fromBlock = input.deployment.deploymentBlock;
    fromBlock <= input.blockNumber;
    fromBlock += CREATOR_CLAIM_LOG_RANGE
  ) {
    const toBlock =
      fromBlock + CREATOR_CLAIM_LOG_RANGE - 1n < input.blockNumber
        ? fromBlock + CREATOR_CLAIM_LOG_RANGE - 1n
        : input.blockNumber;
    logs.push(...await input.client.getLogs({
      address: input.deployment.launcher,
      event: memeTokenLaunchedEvent,
      args: { poolId: input.poolId },
      fromBlock,
      toBlock,
      strict: true,
    }));
  }
  const matches = logs.filter(
    (log) => !log.removed && log.blockNumber !== null,
  );
  if (matches.length === 0) {
    throw new ActionRpcIdentityError(
      "unknown-pool",
      "This pool is not a verified Programmable launch",
    );
  }
  if (matches.length !== 1) {
    throw new ActionRpcIdentityError(
      "ambiguous-identity",
      "The pool matches more than one canonical launch",
    );
  }
  const launch = matches[0];
  const token = getAddress(launch.args.token);
  const hook = getAddress(launch.args.feeHook);
  const launchCreator = getAddress(launch.args.creator);
  if (!sameHex(hook, input.deployment.feeHook)) {
    throw new ActionRpcIdentityError(
      "identity-mismatch",
      "The pool does not use the canonical creator fee hook",
    );
  }
  const [launchHash, poolKey, tokenCreator] = await Promise.all([
    input.client.readContract({
      address: input.deployment.launcher,
      abi: classicLauncherStateAbi,
      functionName: "launchHashOf",
      args: [token],
      blockNumber: input.blockNumber,
    }),
    input.client.readContract({
      address: input.deployment.launcher,
      abi: classicLauncherStateAbi,
      functionName: "poolKey",
      args: [token],
      blockNumber: input.blockNumber,
    }),
    input.client.readContract({
      address: token,
      abi: uerc20ReadAbi,
      functionName: "creator",
      blockNumber: input.blockNumber,
    }),
  ]);
  const canonicalId = canonicalPoolId(
    poolKey as ClassicPoolKeyState,
    token,
    hook,
  );
  // Launcher-created UERC20s record the launcher as token creator; the fee
  // recipient is the distinct creator committed by the launch event.
  if (
    !sameHex(launchHash, launch.args.launchHash) ||
    !sameHex(canonicalId, input.poolId) ||
    !sameHex(tokenCreator, input.deployment.launcher)
  ) {
    throw new ActionRpcIdentityError(
      "identity-mismatch",
      "The current launch state does not match the requested pool",
    );
  }
  return {
    tokenAddress: token,
    hookAddress: hook,
    poolId: input.poolId,
    creatorAddress: launchCreator,
    totalSwapFeeBps: launch.args.totalSwapFeeBps,
  };
}
