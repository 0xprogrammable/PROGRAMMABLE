import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import {
  classicV3HookAbi,
  feeSplitVaultAbi,
  feeSplitVaultFactoryAbi,
  isClassicV3DeploymentReady,
  type ClassicV3DeploymentManifest,
} from "@/lib/classic-v3";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { encodeClassicV3RewardAction } from "@/lib/profile/classic-v3-rewards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const LOG_RANGE = 10_000n;
const CONFIRMATIONS = 12n;
const classicV3LaunchEvent = parseAbiItem(
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
);

const environment =
  process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const manifest = appDeployments[
  environment
] as unknown as ClassicV3DeploymentManifest;
const chain = environment === "rehearsal" ? sepolia : mainnet;
const rpcUrl =
  environment === "rehearsal"
    ? process.env.SEPOLIA_RPC_URL ?? "https://sepolia.drpc.org"
    : process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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
  expectedHash: string,
  label: string,
) {
  const code = await client.getCode({ address });
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error(`${label} does not match the Classic V3 manifest`);
  }
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function readLaunchLogs(
  client: PublicClient,
  launcher: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const logs = [];
  for (
    let rangeStart = fromBlock;
    rangeStart <= toBlock;
    rangeStart += LOG_RANGE
  ) {
    logs.push(
      ...(await client.getLogs({
        address: launcher,
        event: classicV3LaunchEvent,
        fromBlock: rangeStart,
        toBlock: minimum(toBlock, rangeStart + LOG_RANGE - 1n),
        strict: true,
      })),
    );
  }
  return logs;
}

function beneficiaryEntitlement(
  totalReceived: bigint,
  beneficiaries: readonly { beneficiary: Address; shareBps: number }[],
  account: Address,
) {
  const index = beneficiaries.findIndex(
    (item) => item.beneficiary.toLowerCase() === account.toLowerCase(),
  );
  if (index < 0) return 0n;
  if (index !== beneficiaries.length - 1) {
    return (
      (totalReceived * BigInt(beneficiaries[index].shareBps)) /
      10_000n
    );
  }
  return beneficiaries
    .slice(0, -1)
    .reduce(
      (remaining, item) =>
        remaining - (totalReceived * BigInt(item.shareBps)) / 10_000n,
      totalReceived,
    );
}

async function readRewards(account: Address) {
  if (!isClassicV3DeploymentReady(manifest, chain.id)) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: chain.id,
      rewards: [],
    };
  }

  const launcher = getAddress(manifest.memeLaunchV2 as string);
  const hook = getAddress(manifest.ethCreatorFeeHookV3 as string);
  const vaultFactory = getAddress(manifest.feeSplitVaultFactoryV1 as string);
  const client = createClient();
  await Promise.all([
    assertCodeHash(
      client,
      launcher,
      manifest.runtimeCodeHashes?.memeLaunchV2 as string,
      "Classic V3 launcher",
    ),
    assertCodeHash(
      client,
      hook,
      manifest.runtimeCodeHashes?.ethCreatorFeeHookV3 as string,
      "Classic V3 hook",
    ),
    assertCodeHash(
      client,
      vaultFactory,
      manifest.runtimeCodeHashes?.feeSplitVaultFactoryV1 as string,
      "Classic V3 reward factory",
    ),
  ]);

  const latestBlock = await client.getBlockNumber();
  const snapshotBlock =
    latestBlock > CONFIRMATIONS ? latestBlock - CONFIRMATIONS : latestBlock;
  const deploymentBlock = BigInt(
    manifest.deploymentBlocks?.memeLaunchV2 as number,
  );
  const logs =
    deploymentBlock <= snapshotBlock
      ? await readLaunchLogs(client, launcher, deploymentBlock, snapshotBlock)
      : [];

  const relevant = (
    await Promise.all(
      logs.map(async (log) => {
        if (log.removed) return null;
        const share = await client.readContract({
          address: getAddress(log.args.rewardVault),
          abi: feeSplitVaultAbi,
          functionName: "shareBpsOf",
          args: [account],
          blockNumber: snapshotBlock,
        });
        return share > 0 ? { log, share } : null;
      }),
    )
  ).filter((item) => item !== null);

  const rewards = await Promise.all(
    relevant.map(async ({ log, share }) => {
      const tokenAddress = getAddress(log.args.token);
      const vaultAddress = getAddress(log.args.rewardVault);
      const poolId = log.args.poolId;
      const [
        tokenName,
        tokenSymbol,
        payoutAddress,
        claimedBy,
        totalReceived,
        beneficiaryCount,
        factoryVault,
        disclosure,
        poolConfig,
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
        client.readContract({
          address: vaultAddress,
          abi: feeSplitVaultAbi,
          functionName: "payoutAddressOf",
          args: [account],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: feeSplitVaultAbi,
          functionName: "claimedBy",
          args: [account],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: feeSplitVaultAbi,
          functionName: "totalCreatorFeesReceived",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: feeSplitVaultAbi,
          functionName: "beneficiaryCount",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultFactory,
          abi: feeSplitVaultFactoryAbi,
          functionName: "isFactoryVault",
          args: [vaultAddress],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: hook,
          abi: classicV3HookAbi,
          functionName: "feeDisclosure",
          args: [poolId],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: hook,
          abi: classicV3HookAbi,
          functionName: "poolFeeConfig",
          args: [poolId],
          blockNumber: snapshotBlock,
        }),
      ]);
      if (
        !factoryVault ||
        disclosure[7].toLowerCase() !== vaultAddress.toLowerCase() ||
        poolConfig[0].toLowerCase() !== vaultAddress.toLowerCase() ||
        !poolConfig[4] ||
        disclosure[0] !== log.args.buySwapFeeBps ||
        disclosure[1] !== log.args.sellSwapFeeBps ||
        disclosure[4] !== 10 ||
        disclosure[5] !== 0 ||
        disclosure[6] !== 0
      ) {
        throw new Error("Classic V3 reward configuration is inconsistent");
      }
      if (beneficiaryCount < 1n || beneficiaryCount > 8n) {
        throw new Error("Classic V3 reward split is outside its bounds");
      }

      const beneficiaries = await Promise.all(
        Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
          const beneficiary = await client.readContract({
            address: vaultAddress,
            abi: feeSplitVaultAbi,
            functionName: "beneficiaryAt",
            args: [BigInt(index)],
            blockNumber: snapshotBlock,
          });
          const [beneficiaryShare, beneficiaryPayout] = await Promise.all([
            client.readContract({
              address: vaultAddress,
              abi: feeSplitVaultAbi,
              functionName: "shareBpsOf",
              args: [beneficiary],
              blockNumber: snapshotBlock,
            }),
            client.readContract({
              address: vaultAddress,
              abi: feeSplitVaultAbi,
              functionName: "payoutAddressOf",
              args: [beneficiary],
              blockNumber: snapshotBlock,
            }),
          ]);
          return {
            beneficiary: getAddress(beneficiary),
            payoutAddress: getAddress(beneficiaryPayout),
            shareBps: beneficiaryShare,
          };
        }),
      );
      const prospectiveTotalReceived = totalReceived + poolConfig[5];
      const entitlement = beneficiaryEntitlement(
        prospectiveTotalReceived,
        beneficiaries,
        account,
      );
      const claimable = entitlement > claimedBy ? entitlement - claimedBy : 0n;

      return {
        tokenAddress,
        tokenName,
        tokenSymbol,
        poolId,
        vaultAddress,
        beneficiary: account,
        payoutAddress: getAddress(payoutAddress),
        shareBps: share,
        claimableWei: claimable.toString(),
        claimableEth: formatUnits(claimable, 18),
        claimedWei: claimedBy.toString(),
        claimedEth: formatUnits(claimedBy, 18),
        buySwapFeeBps: disclosure[0],
        sellSwapFeeBps: disclosure[1],
        platformFeeBps: 10 as const,
        beneficiaries,
        launchTransactionHash: log.transactionHash,
      };
    }),
  );

  return {
    status: "ready" as const,
    account,
    chainId: chain.id,
    rewards,
  };
}

async function readLaunchByTransaction(account: Address, transactionHash: Hex) {
  if (!isClassicV3DeploymentReady(manifest, chain.id)) {
    return { status: "not-deployed" as const, launch: null };
  }
  const launcher = getAddress(manifest.memeLaunchV2 as string);
  const client = createClient();
  await assertCodeHash(
    client,
    launcher,
    manifest.runtimeCodeHashes?.memeLaunchV2 as string,
    "Classic V3 launcher",
  );
  const latestBlock = await client.getBlockNumber();
  const snapshotBlock =
    latestBlock > CONFIRMATIONS ? latestBlock - CONFIRMATIONS : latestBlock;
  const deploymentBlock = BigInt(
    manifest.deploymentBlocks?.memeLaunchV2 as number,
  );
  const logs =
    deploymentBlock <= snapshotBlock
      ? await readLaunchLogs(client, launcher, deploymentBlock, snapshotBlock)
      : [];
  const launch = logs.find(
    (log) =>
      !log.removed &&
      log.args.deployer.toLowerCase() === account.toLowerCase() &&
      log.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
  );
  if (!launch) {
    return { status: "ready" as const, launch: null };
  }
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
    console.error("Classic V3 profile read failed", error);
    return json({ error: "Classic V3 rewards are temporarily unavailable" }, 503);
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
      return json({ error: "Classic V3 is not deployed yet" }, 409);
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
    const data = encodeClassicV3RewardAction({
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
    const kind =
      input.action === "claim"
        ? "claim-classic-v3-rewards"
        : "update-classic-v3-payout";
    return json({
      status: "ready",
      action: input.action,
      account,
      vaultAddress,
      transaction: {
        kind,
        chainId: chain.id,
        from: account,
        to: vaultAddress,
        data,
        value: "0",
        gasLimit: gasLimit.toString(),
      },
    });
  } catch (error) {
    console.error("Classic V3 reward preparation failed", error);
    return json(
      { error: "The reward action could not be simulated from current onchain state" },
      502,
    );
  }
}
