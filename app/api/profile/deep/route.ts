import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import {
  DEEP_GROWTH_TARGET_WEI,
  DEEP_TOKEN_RESERVE_WHOLE,
} from "@/lib/launch";
import {
  deepAutomationReadAbi,
  deepGrowthVaultFactoryReadAbi,
  deepGrowthVaultReadAbi,
  deepHookReadAbi,
  deepTokenLaunchedEvent,
  DEEP_COMPLETION_TOLERANCE_WEI,
  DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI,
} from "@/lib/deep-v1";
import {
  getVerifiedDeepRelease,
  type DeepLaunchModelRelease,
  type LaunchModelReleaseManifest,
} from "@/lib/launch-model-gating";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { sanitizeImageUrl } from "@/lib/onchain/metadata";
import { encodeDeepRewardAction } from "@/lib/profile/deep-rewards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const LOG_RANGE = 10_000n;
const CONFIRMATIONS = 12n;
const DEEP_TOKEN_RESERVE_RAW =
  BigInt(DEEP_TOKEN_RESERVE_WHOLE) * 10n ** 18n;

const environment =
  process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const chain = environment === "rehearsal" ? sepolia : mainnet;
const deployment = appDeployments[
  environment
] as unknown as LaunchModelReleaseManifest;
const rpcUrl =
  environment === "rehearsal"
    ? process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org"
    : process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org";

type VerifiedDeepRelease = DeepLaunchModelRelease & {
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
  deploymentBlock: number;
  runtimeCodeHashes: {
    launcher: Hex;
    feeHook: Hex;
    growthVaultFactory: Hex;
    automation: Hex;
  };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function release(): VerifiedDeepRelease | null {
  return (
    getVerifiedDeepRelease(deployment, chain.id) as
      | VerifiedDeepRelease
      | null
  );
}

function createClient() {
  return createPublicClient({
    chain,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 1, timeout: 12_000 }),
  });
}

async function assertCodeHash(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  label: string,
) {
  const code = await client.getCode({ address });
  if (!code || code === "0x" || keccak256(code) !== expectedHash) {
    throw new Error(`${label} does not match the Deep release`);
  }
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function readLaunchLogs(
  client: PublicClient,
  verifiedRelease: VerifiedDeepRelease,
  toBlock: bigint,
) {
  const logs = [];
  for (
    let rangeStart = BigInt(verifiedRelease.deploymentBlock);
    rangeStart <= toBlock;
    rangeStart += LOG_RANGE
  ) {
    logs.push(
      ...(await client.getLogs({
        address: verifiedRelease.launcher,
        event: deepTokenLaunchedEvent,
        fromBlock: rangeStart,
        toBlock: minimum(toBlock, rangeStart + LOG_RANGE - 1n),
        strict: true,
      })),
    );
  }
  return logs;
}

async function confirmedSnapshot(
  client: PublicClient,
  verifiedRelease: VerifiedDeepRelease,
) {
  await Promise.all([
    assertCodeHash(
      client,
      verifiedRelease.launcher,
      verifiedRelease.runtimeCodeHashes.launcher,
      "Deep launcher",
    ),
    assertCodeHash(
      client,
      verifiedRelease.feeHook,
      verifiedRelease.runtimeCodeHashes.feeHook,
      "Deep hook",
    ),
    assertCodeHash(
      client,
      verifiedRelease.growthVaultFactory,
      verifiedRelease.runtimeCodeHashes.growthVaultFactory,
      "Deep growth vault factory",
    ),
    assertCodeHash(
      client,
      verifiedRelease.automation,
      verifiedRelease.runtimeCodeHashes.automation,
      "Deep automation",
    ),
  ]);
  const latestBlock = await client.getBlockNumber();
  return latestBlock > CONFIRMATIONS
    ? latestBlock - CONFIRMATIONS
    : latestBlock;
}

async function readBeneficiaries(
  client: PublicClient,
  vaultAddress: Address,
  beneficiaryCount: bigint,
  snapshotBlock: bigint,
) {
  return Promise.all(
    Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
      const beneficiary = await client.readContract({
        address: vaultAddress,
        abi: deepGrowthVaultReadAbi,
        functionName: "beneficiaryAt",
        args: [BigInt(index)],
        blockNumber: snapshotBlock,
      });
      const [shareBps, payoutAddress] = await Promise.all([
        client.readContract({
          address: vaultAddress,
          abi: deepGrowthVaultReadAbi,
          functionName: "shareBpsOf",
          args: [beneficiary],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: deepGrowthVaultReadAbi,
          functionName: "payoutAddressOf",
          args: [beneficiary],
          blockNumber: snapshotBlock,
        }),
      ]);
      return {
        beneficiary: getAddress(beneficiary),
        payoutAddress: getAddress(payoutAddress),
        shareBps,
      };
    }),
  );
}

async function hydrateReward(
  client: PublicClient,
  verifiedRelease: VerifiedDeepRelease,
  log: Awaited<ReturnType<typeof readLaunchLogs>>[number],
  account: Address,
  snapshotBlock: bigint,
) {
  const tokenAddress = getAddress(log.args.token);
  const vaultAddress = getAddress(log.args.growthVault);
  const poolId = log.args.poolId;
  const [
    tokenName,
    tokenSymbol,
    metadata,
    vaultHook,
    vaultPoolManager,
    vaultPoolId,
    vaultToken,
    vaultOracleGuard,
    upstreamVault,
    configurationHash,
    shareBps,
    payoutAddress,
    claimed,
    claimable,
    beneficiaryCount,
    growthTarget,
    completionTolerance,
    minimumNativeLiquidityForCompletion,
    tokenReserve,
    nativeAllocated,
    nativeAdded,
    pendingGrowth,
    deferredRewardFees,
    growthTargetReached,
    oracleReady,
    workState,
    factoryVault,
    feeDisclosure,
    poolConfig,
    automationAction,
  ] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "name",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "symbol",
      blockNumber: snapshotBlock,
    }),
    client
      .readContract({
        address: tokenAddress,
        abi: uerc20ReadAbi,
        functionName: "metadata",
        blockNumber: snapshotBlock,
      })
      .catch(() => null),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "poolManager",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "poolId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "token",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "oracleGuard",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "upstreamVault",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "configurationHash",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "shareBpsOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "payoutAddressOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "claimedBy",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "claimable",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "beneficiaryCount",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "growthTargetNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "completionToleranceNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "minimumNativeLiquidityForCompletion",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "tokenReserveTarget",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "totalNativeAllocatedToGrowth",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "totalNativeAddedToLiquidity",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "pendingGrowthNative",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "deferredRewardFees",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "growthTargetReached",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "oracleReady",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vaultAddress,
      abi: deepGrowthVaultReadAbi,
      functionName: "workState",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: verifiedRelease.growthVaultFactory,
      abi: deepGrowthVaultFactoryReadAbi,
      functionName: "isFactoryVault",
      args: [vaultAddress],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: verifiedRelease.feeHook,
      abi: deepHookReadAbi,
      functionName: "feeDisclosure",
      args: [poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: verifiedRelease.feeHook,
      abi: deepHookReadAbi,
      functionName: "poolFeeConfig",
      args: [poolId],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: verifiedRelease.automation,
      abi: deepAutomationReadAbi,
      functionName: "checkVault",
      args: [vaultAddress],
      blockNumber: snapshotBlock,
    }),
  ]);

  if (
    !factoryVault ||
    getAddress(vaultHook) !== verifiedRelease.feeHook ||
    getAddress(vaultPoolManager) ===
      "0x0000000000000000000000000000000000000000" ||
    vaultPoolId !== poolId ||
    getAddress(vaultToken) !== tokenAddress ||
    getAddress(vaultOracleGuard) !== getAddress(log.args.oracleGuard) ||
    getAddress(upstreamVault) !== getAddress(log.args.upstreamRewardVault) ||
    configurationHash !== log.args.vaultConfigurationHash ||
    growthTarget !== DEEP_GROWTH_TARGET_WEI ||
    completionTolerance !== DEEP_COMPLETION_TOLERANCE_WEI ||
    minimumNativeLiquidityForCompletion !==
      DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI ||
    tokenReserve !== DEEP_TOKEN_RESERVE_RAW ||
    beneficiaryCount < 1n ||
    beneficiaryCount > 8n ||
    workState[2] !== pendingGrowth ||
    workState[0] > 2 ||
    automationAction > 3 ||
    feeDisclosure[0] !== log.args.buySwapFeeBps ||
    feeDisclosure[1] !== log.args.sellSwapFeeBps ||
    feeDisclosure[4] !== 10 ||
    feeDisclosure[5] !== 0 ||
    feeDisclosure[6] !== 0 ||
    getAddress(feeDisclosure[7]) !== getAddress(log.args.upstreamRewardVault) ||
    getAddress(poolConfig[0]) !== getAddress(log.args.upstreamRewardVault) ||
    getAddress(poolConfig[1]) !== verifiedRelease.launcher ||
    poolConfig[2] !== log.args.buySwapFeeBps ||
    poolConfig[3] !== log.args.sellSwapFeeBps ||
    !poolConfig[4]
  ) {
    throw new Error("Deep reward configuration is inconsistent");
  }
  const beneficiaries = await readBeneficiaries(
    client,
    vaultAddress,
    beneficiaryCount,
    snapshotBlock,
  );
  if (
    beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !==
      10_000 ||
    beneficiaries.filter(
      (item) =>
        item.beneficiary.toLowerCase() === account.toLowerCase(),
    ).length !== 1
  ) {
    throw new Error("Deep reward split is inconsistent");
  }

  return {
    model: "deep" as const,
    tokenAddress,
    tokenName,
    tokenSymbol,
    ...(sanitizeImageUrl(metadata?.[2] ?? "")
      ? { imageUrl: sanitizeImageUrl(metadata?.[2] ?? "") }
      : {}),
    poolId,
    vaultAddress,
    oracleGuardAddress: getAddress(log.args.oracleGuard),
    upstreamRewardVaultAddress: getAddress(log.args.upstreamRewardVault),
    beneficiary: account,
    payoutAddress: getAddress(payoutAddress),
    shareBps,
    claimableWei: claimable.toString(),
    claimableEth: formatUnits(claimable, 18),
    claimedWei: claimed.toString(),
    claimedEth: formatUnits(claimed, 18),
    buySwapFeeBps: feeDisclosure[0],
    sellSwapFeeBps: feeDisclosure[1],
    platformFeeBps: 10 as const,
    beneficiaries,
    growthTargetWei: growthTarget.toString(),
    growthTargetEth: formatUnits(growthTarget, 18),
    completionToleranceWei: completionTolerance.toString(),
    minimumNativeLiquidityForCompletionWei:
      minimumNativeLiquidityForCompletion.toString(),
    nativeAllocatedToGrowthWei: nativeAllocated.toString(),
    nativeAllocatedToGrowthEth: formatUnits(nativeAllocated, 18),
    nativeAddedToLiquidityWei: nativeAdded.toString(),
    nativeAddedToLiquidityEth: formatUnits(nativeAdded, 18),
    pendingGrowthNativeWei: pendingGrowth.toString(),
    pendingGrowthNativeEth: formatUnits(pendingGrowth, 18),
    deferredRewardFeesWei: deferredRewardFees.toString(),
    deferredRewardFeesEth: formatUnits(deferredRewardFees, 18),
    tokenReserveRaw: tokenReserve.toString(),
    growthTargetReached,
    oracleReady,
    automationAction,
    nextCompoundTimestamp: workState[3].toString(),
    trustedNativeDepthWei: workState[4].toString(),
    depthCapNativeWei: workState[5].toString(),
    automationGuaranteed: false as const,
    launchTransactionHash: log.transactionHash,
  };
}

async function readRewards(account: Address) {
  const verifiedRelease = release();
  if (!verifiedRelease) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: chain.id,
      rewards: [],
    };
  }
  const client = createClient();
  const snapshotBlock = await confirmedSnapshot(client, verifiedRelease);
  const logs =
    BigInt(verifiedRelease.deploymentBlock) <= snapshotBlock
      ? await readLaunchLogs(client, verifiedRelease, snapshotBlock)
      : [];
  const relevant = (
    await Promise.all(
      logs.map(async (log) => {
        if (log.removed) return null;
        const share = await client.readContract({
          address: getAddress(log.args.growthVault),
          abi: deepGrowthVaultReadAbi,
          functionName: "shareBpsOf",
          args: [account],
          blockNumber: snapshotBlock,
        });
        return share > 0 ? log : null;
      }),
    )
  ).filter((log) => log !== null);

  return {
    status: "ready" as const,
    account,
    chainId: chain.id,
    rewards: await Promise.all(
      relevant.map((log) =>
        hydrateReward(
          client,
          verifiedRelease,
          log,
          account,
          snapshotBlock,
        ),
      ),
    ),
  };
}

async function readLaunchByTransaction(account: Address, transactionHash: Hex) {
  const verifiedRelease = release();
  if (!verifiedRelease) {
    return { status: "not-deployed" as const, launch: null };
  }
  const client = createClient();
  const snapshotBlock = await confirmedSnapshot(client, verifiedRelease);
  const logs =
    BigInt(verifiedRelease.deploymentBlock) <= snapshotBlock
      ? await readLaunchLogs(client, verifiedRelease, snapshotBlock)
      : [];
  const launch = logs.find(
    (log) =>
      !log.removed &&
      log.args.deployer.toLowerCase() === account.toLowerCase() &&
      log.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
  );
  if (!launch) return { status: "ready" as const, launch: null };
  const tokenAddress = getAddress(launch.args.token);
  const [name, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "name",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: tokenAddress,
      abi: uerc20ReadAbi,
      functionName: "symbol",
      blockNumber: snapshotBlock,
    }),
  ]);
  return {
    status: "ready" as const,
    launch: {
      tokenAddress,
      name,
      symbol,
      launchTransactionHash: launch.transactionHash,
    },
  };
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    const launch = request.nextUrl.searchParams.get("launch")?.trim();
    if (launch) {
      if (!isHex(launch, { strict: true }) || launch.length !== 66) {
        return json({ error: "Enter a valid launch transaction hash" }, 400);
      }
      return json(
        await readLaunchByTransaction(getAddress(input), launch as Hex),
      );
    }
    return json(await readRewards(getAddress(input)));
  } catch (error) {
    console.error("Deep profile read failed", error);
    return json({ error: "Deep rewards are temporarily unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return json({ error: "The reward request is too large" }, 413);
  }
  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The reward request is too large" }, 413);
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Send a valid reward request" }, 400);
  }

  if (
    (input.action !== "claim" && input.action !== "update-payout") ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.vaultAddress !== "string" ||
    !isAddress(input.vaultAddress) ||
    input.chainId !== chain.id
  ) {
    return json({ error: "The reward request is invalid" }, 400);
  }
  const account = getAddress(input.account);
  const vaultAddress = getAddress(input.vaultAddress);
  let newPayoutAddress: Address | undefined;
  if (input.action === "update-payout") {
    if (
      typeof input.newPayoutAddress !== "string" ||
      !isAddress(input.newPayoutAddress)
    ) {
      return json({ error: "Enter a valid payout address" }, 400);
    }
    newPayoutAddress = getAddress(input.newPayoutAddress);
  }

  try {
    const profile = await readRewards(account);
    if (profile.status !== "ready") {
      return json({ error: "Deep is not deployed yet" }, 409);
    }
    const reward = profile.rewards.find(
      (item) =>
        item.vaultAddress.toLowerCase() === vaultAddress.toLowerCase(),
    );
    if (!reward) {
      return json(
        { error: "Only this vault's immutable beneficiary can continue" },
        403,
      );
    }
    if (input.action === "claim" && BigInt(reward.claimableWei) === 0n) {
      return json({ error: "There are no rewards to claim" }, 409);
    }
    const data = encodeDeepRewardAction({
      action: input.action,
      newPayoutAddress,
    });
    const client = createClient();
    await client.call({
      account,
      to: vaultAddress,
      data,
      value: 0n,
    });
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      client.estimateGas({
        account,
        to: vaultAddress,
        data,
        value: 0n,
      }),
      client.getGasPrice(),
      client.getBalance({ address: account }),
    ]);
    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    if (balance < gasLimit * gasPrice) {
      return json(
        { error: "This wallet needs more ETH for the network fee" },
        409,
      );
    }
    return json({
      status: "ready",
      action: input.action,
      account,
      vaultAddress,
      transaction: {
        kind:
          input.action === "claim"
            ? "claim-deep-rewards"
            : "update-deep-payout",
        chainId: chain.id,
        from: account,
        to: vaultAddress,
        data,
        value: "0",
        gasLimit: gasLimit.toString(),
      },
    });
  } catch (error) {
    console.error("Deep reward preparation failed", error);
    return json(
      {
        error:
          "The reward action could not be simulated from current onchain state",
      },
      502,
    );
  }
}
