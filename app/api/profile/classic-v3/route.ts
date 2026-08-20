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
  classicRewardVaultAbi,
  classicRewardVaultFactoryAbi,
  classicV3HookAbi,
  type ClassicV3DeploymentManifest,
} from "@/lib/classic-v3";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "@/lib/classic-v3-release";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { getWebsiteReadOnchainDeployment } from "@/lib/onchain";
import {
  readEnvioClassicV3CatalogV1,
} from "@/lib/market-data/envio-classic-v3-catalog.server";
import {
  safeOperationalRpcError,
  withOperationalRpcFailover,
} from
  "@/lib/onchain/operational-rpc-failover.server";
import {
  classicV3ProfileApiError,
  encodeClassicV3RewardAction,
} from "@/lib/profile/classic-v3-rewards";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const LOG_RANGE = 10_000n;
const CONFIRMATIONS = 12n;

type ClassicActionRewardIdentity = Readonly<{
  vaultAddress: Address;
  poolId: Hex;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  buyCreatorFeeBps: number | null;
  sellCreatorFeeBps: number | null;
  launcherFeeBps: number;
  transferTaxBps: number;
  lpFeePips: number;
}>;
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
const releaseManifest =
  getConfiguredClassicV3Release(environment).releaseManifest;
const chain = environment === "rehearsal" ? sepolia : mainnet;
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function createActionClient(rpcUrl: string) {
  return createPublicClient({
    chain,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 1, timeout: 12_000 }),
  });
}

async function currentActionBlock(client: PublicClient) {
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error("The configured RPC returned no block hash");
  return blockNumber;
}

function classicActionDeployment() {
  const deployment = getWebsiteReadOnchainDeployment(environment);
  if (deployment.chainId !== chain.id) {
    throw new Error("Classic action RPC chain does not match the release");
  }
  return deployment;
}

function classicRpcProviderHeader(
  deployment: ReturnType<typeof classicActionDeployment>,
  rpcUrl: string,
) {
  const role = rpcUrl === deployment.rpcUrl ? "primary" : "secondary";
  const provider = deployment.rpcProviderIds?.[role] ?? "rpc";
  return `${provider}-${role}`;
}

async function assertCodeHashAtBlock(
  client: PublicClient,
  address: Address,
  expectedHash: string,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error(`${label} does not match the Classic manifest`);
  }
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
    throw new Error(`${label} does not match the Classic manifest`);
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
  deployer?: Address,
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
        ...(deployer ? { args: { deployer } } : {}),
        fromBlock: rangeStart,
        toBlock: minimum(toBlock, rangeStart + LOG_RANGE - 1n),
        strict: true,
      })),
    );
  }
  return logs;
}

async function readLaunchByTransactionFromClient(
  account: Address,
  transactionHash: Hex,
  client: PublicClient,
) {
  if (!isClassicV3ReleaseVerified(manifest, releaseManifest, chain.id)) {
    return { status: "not-deployed" as const, launch: null };
  }
  const launcher = getAddress(manifest.memeLaunchV2 as string);
  await assertCodeHash(
    client,
    launcher,
    manifest.runtimeCodeHashes?.memeLaunchV2 as string,
    "Classic launcher",
  );
  const latestBlock = await client.getBlockNumber();
  const snapshotBlock = latestBlock > CONFIRMATIONS
    ? latestBlock - CONFIRMATIONS
    : latestBlock;
  const deploymentBlock = BigInt(
    manifest.deploymentBlocks?.memeLaunchV2 as number,
  );
  const logs = deploymentBlock <= snapshotBlock
    ? await readLaunchLogs(
        client,
        launcher,
        deploymentBlock,
        snapshotBlock,
        account,
      )
    : [];
  const launch = logs.find(
    (candidate) =>
      !candidate.removed &&
      candidate.transactionHash.toLowerCase() === transactionHash.toLowerCase(),
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

function prospectiveAllocation(
  amount: bigint,
  allocations: readonly { payoutAddress: Address; shareBps: number }[],
  account: Address,
) {
  let allocated = 0n;
  let accountAmount = 0n;
  for (let index = 0; index < allocations.length; index += 1) {
    const allocation =
      index === allocations.length - 1
        ? amount - allocated
        : (amount * BigInt(allocations[index].shareBps)) / 10_000n;
    allocated += allocation;
    if (
      allocations[index].payoutAddress.toLowerCase() ===
      account.toLowerCase()
    ) {
      accountAmount += allocation;
    }
  }
  return accountAmount;
}

async function readClassicActionState(input: {
  client: PublicClient;
  reward: ClassicActionRewardIdentity;
  account: Address;
  blockNumber: bigint;
  allocationIndex?: number;
}) {
  const { client, reward, account, blockNumber, allocationIndex } = input;
  const hook = getAddress(manifest.ethCreatorFeeHookV3 as string);
  const launcher = getAddress(manifest.memeLaunchV2 as string);
  const vaultFactory = getAddress(
    manifest.classicRewardVaultFactoryV1 as string,
  );
  await Promise.all([
    assertCodeHashAtBlock(
      client,
      launcher,
      manifest.runtimeCodeHashes?.memeLaunchV2 as string,
      blockNumber,
      "Classic launcher",
    ),
    assertCodeHashAtBlock(
      client,
      hook,
      manifest.runtimeCodeHashes?.ethCreatorFeeHookV3 as string,
      blockNumber,
      "Classic hook",
    ),
    assertCodeHashAtBlock(
      client,
      vaultFactory,
      manifest.runtimeCodeHashes?.classicRewardVaultFactoryV1 as string,
      blockNumber,
      "Classic reward factory",
    ),
  ]);
  const [
    vaultCode,
    factoryVault,
    vaultHook,
    vaultPoolId,
    beneficiaryCount,
    shareBps,
    checkpointed,
    claimed,
    disclosure,
    poolConfig,
  ] = await Promise.all([
    client.getCode({ address: reward.vaultAddress, blockNumber }),
    client.readContract({
      address: vaultFactory,
      abi: classicRewardVaultFactoryAbi,
      functionName: "isFactoryVault",
      args: [reward.vaultAddress],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "feeHook",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "poolId",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "beneficiaryCount",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "shareBpsOf",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "claimable",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "claimedBy",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "feeDisclosure",
      args: [reward.poolId],
      blockNumber,
    }),
    client.readContract({
      address: hook,
      abi: classicV3HookAbi,
      functionName: "poolFeeConfig",
      args: [reward.poolId],
      blockNumber,
    }),
  ]);
  if (
    !vaultCode ||
    vaultCode === "0x" ||
    !factoryVault ||
    getAddress(vaultHook).toLowerCase() !== hook.toLowerCase() ||
    vaultPoolId.toLowerCase() !== reward.poolId.toLowerCase() ||
    beneficiaryCount < 1n ||
    beneficiaryCount > 5n ||
    disclosure[7].toLowerCase() !== reward.vaultAddress.toLowerCase() ||
    poolConfig[0].toLowerCase() !== reward.vaultAddress.toLowerCase() ||
    getAddress(poolConfig[1]).toLowerCase() !== launcher.toLowerCase() ||
    !poolConfig[4] ||
    Number(disclosure[0]) !== reward.buySwapFeeBps ||
    Number(disclosure[1]) !== reward.sellSwapFeeBps ||
    (reward.buyCreatorFeeBps !== null &&
      Number(disclosure[2]) !== reward.buyCreatorFeeBps) ||
    (reward.sellCreatorFeeBps !== null &&
      Number(disclosure[3]) !== reward.sellCreatorFeeBps) ||
    Number(disclosure[2]) + Number(disclosure[4]) !==
      Number(disclosure[0]) ||
    Number(disclosure[3]) + Number(disclosure[4]) !==
      Number(disclosure[1]) ||
    Number(disclosure[4]) !== reward.launcherFeeBps ||
    Number(disclosure[5]) !== reward.transferTaxBps ||
    Number(disclosure[6]) !== reward.lpFeePips ||
    Number(poolConfig[2]) !== reward.buySwapFeeBps ||
    Number(poolConfig[3]) !== reward.sellSwapFeeBps
  ) {
    throw new Error("Classic reward provenance does not match the indexed launch");
  }
  const allocations = await Promise.all(
    Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
      const [beneficiary, allocationShare] = await Promise.all([
        client.readContract({
          address: reward.vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "beneficiaryAt",
          args: [BigInt(index)],
          blockNumber,
        }),
        client.readContract({
          address: reward.vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "shareBpsAt",
          args: [BigInt(index)],
          blockNumber,
        }),
      ]);
      return {
        allocationIndex: index,
        payoutAddress: getAddress(beneficiary),
        shareBps: Number(allocationShare),
      };
    }),
  );
  if (
    new Set(allocations.map((item) => item.payoutAddress.toLowerCase())).size !==
      allocations.length ||
    allocations.some((item) => item.shareBps <= 0) ||
    allocations.reduce((sum, item) => sum + item.shareBps, 0) !== 10_000 ||
    allocations
      .filter(
        (item) => item.payoutAddress.toLowerCase() === account.toLowerCase(),
      )
      .reduce((sum, item) => sum + item.shareBps, 0) !== Number(shareBps)
  ) {
    throw new Error("Classic reward allocation is invalid");
  }
  const prospective = prospectiveAllocation(
    poolConfig[5],
    allocations,
    account,
  );
  const claimable = checkpointed + prospective;
  const ownsAllocation =
    allocationIndex === undefined
      ? false
      : allocations.some(
          (item) =>
            item.allocationIndex === allocationIndex &&
            item.payoutAddress.toLowerCase() === account.toLowerCase(),
        );
  return {
    claimableWei: claimable.toString(),
    claimedWei: claimed.toString(),
    shareBps: Number(shareBps),
    ownsAllocation,
    allocations: allocations.map((item) => ({
      ...item,
      payoutAddress: item.payoutAddress.toLowerCase(),
    })),
  };
}

async function readRewardsFromClient(
  account: Address,
  client: PublicClient,
) {
  if (!isClassicV3ReleaseVerified(manifest, releaseManifest, chain.id)) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: chain.id,
      rewards: [],
    };
  }

  const launcher = getAddress(manifest.memeLaunchV2 as string);
  const hook = getAddress(manifest.ethCreatorFeeHookV3 as string);
  const vaultFactory = getAddress(
    manifest.classicRewardVaultFactoryV1 as string,
  );
  await Promise.all([
    assertCodeHash(
      client,
      launcher,
      manifest.runtimeCodeHashes?.memeLaunchV2 as string,
      "Classic launcher",
    ),
    assertCodeHash(
      client,
      hook,
      manifest.runtimeCodeHashes?.ethCreatorFeeHookV3 as string,
      "Classic hook",
    ),
    assertCodeHash(
      client,
      vaultFactory,
      manifest.runtimeCodeHashes?.classicRewardVaultFactoryV1 as string,
      "Classic reward factory",
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
        const vaultAddress = getAddress(log.args.rewardVault);
        const [share, checkpointed, claimed] = await Promise.all([
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "shareBpsOf",
            args: [account],
            blockNumber: snapshotBlock,
          }),
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "claimable",
            args: [account],
            blockNumber: snapshotBlock,
          }),
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "claimedBy",
            args: [account],
            blockNumber: snapshotBlock,
          }),
        ]);
        return share > 0 || checkpointed > 0n || claimed > 0n
          ? { log, share, checkpointed, claimed }
          : null;
      }),
    )
  ).filter((item) => item !== null);

  const rewards = await Promise.all(
    relevant.map(async ({ log, share, checkpointed, claimed }) => {
      const tokenAddress = getAddress(log.args.token);
      const vaultAddress = getAddress(log.args.rewardVault);
      const poolId = log.args.poolId;
      const [
        tokenName,
        tokenSymbol,
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
          abi: classicRewardVaultAbi,
          functionName: "beneficiaryCount",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultFactory,
          abi: classicRewardVaultFactoryAbi,
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
        throw new Error("Classic reward configuration is inconsistent");
      }
      if (beneficiaryCount < 1n || beneficiaryCount > 5n) {
        throw new Error("Classic reward split is outside its bounds");
      }

      const beneficiaries = await Promise.all(
        Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
          const [payoutAddress, allocationShare] = await Promise.all([
            client.readContract({
              address: vaultAddress,
              abi: classicRewardVaultAbi,
              functionName: "beneficiaryAt",
              args: [BigInt(index)],
              blockNumber: snapshotBlock,
            }),
            client.readContract({
              address: vaultAddress,
              abi: classicRewardVaultAbi,
              functionName: "shareBpsAt",
              args: [BigInt(index)],
              blockNumber: snapshotBlock,
            }),
          ]);
          return {
            allocationIndex: index,
            beneficiary: getAddress(payoutAddress),
            payoutAddress: getAddress(payoutAddress),
            shareBps: allocationShare,
          };
        }),
      );
      const prospective = prospectiveAllocation(
        poolConfig[5],
        beneficiaries,
        account,
      );
      const claimable = checkpointed + prospective;
      const ownedAllocations = beneficiaries.filter(
        (item) =>
          item.payoutAddress.toLowerCase() === account.toLowerCase(),
      );

      return {
        tokenAddress,
        tokenName,
        tokenSymbol,
        poolId,
        vaultAddress,
        beneficiary: account,
        payoutAddress: account,
        shareBps: share,
        ownedAllocations,
        claimableWei: claimable.toString(),
        claimableEth: formatUnits(claimable, 18),
        claimedWei: claimed.toString(),
        claimedEth: formatUnits(claimed, 18),
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

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "account" && key !== "launch",
    ) ||
    search.getAll("account").length !== 1 ||
    search.getAll("launch").length > 1
  ) {
    return json({ error: "Unsupported query parameters" }, 400);
  }
  const input = search.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    const launch = search.get("launch")?.trim();
    const deployment = classicActionDeployment();
    if (launch) {
      if (!isHex(launch, { strict: true }) || launch.length !== 66) {
        return json({ error: "Enter a valid launch transaction hash" }, 400);
      }
      const result = await withOperationalRpcFailover(
        deployment,
        async (selected) => ({
          profile: await readLaunchByTransactionFromClient(
            getAddress(input),
            launch as Hex,
            createActionClient(selected.rpcUrl),
          ),
          provider: classicRpcProviderHeader(deployment, selected.rpcUrl),
        }),
      );
      return NextResponse.json(
        result.profile,
        {
          headers: {
            "Cache-Control": "private, max-age=0, s-maxage=15",
            "X-Programmable-Read-Source": "rpc",
            "X-Programmable-Rpc-Provider": result.provider,
          },
        },
      );
    }
    const result = await withOperationalRpcFailover(
      deployment,
      async (selected) => ({
        profile: await readRewardsFromClient(
          getAddress(input),
          createActionClient(selected.rpcUrl),
        ),
        provider: classicRpcProviderHeader(deployment, selected.rpcUrl),
      }),
    );
    return NextResponse.json(
      result.profile,
      {
        headers: {
          "Cache-Control": "private, max-age=0, s-maxage=15",
          "X-Programmable-Read-Source": "rpc",
          "X-Programmable-Rpc-Provider": result.provider,
        },
      },
    );
  } catch (error) {
    console.error(
      "Classic profile RPC read failed",
      safeOperationalRpcError(error),
    );
    return json(classicV3ProfileApiError("temporary"), 503);
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
  const action = input.action as "claim" | "update-payout";
  let newPayoutAddress: Address | undefined;
  let allocationIndex: number | undefined;
  if (action === "update-payout") {
    if (
      typeof input.allocationIndex !== "number" ||
      !Number.isSafeInteger(input.allocationIndex) ||
      input.allocationIndex < 0 ||
      input.allocationIndex >= 5 ||
      typeof input.newPayoutAddress !== "string" ||
      !isAddress(input.newPayoutAddress)
    ) {
      return json({ error: "Choose a valid reward allocation and payout address" }, 400);
    }
    allocationIndex = input.allocationIndex;
    newPayoutAddress = getAddress(input.newPayoutAddress);
  }

  try {
    if (!isClassicV3ReleaseVerified(manifest, releaseManifest, chain.id)) {
      return json({ error: "Classic is not deployed yet" }, 409);
    }
    const catalog = await readEnvioClassicV3CatalogV1({
      signal: request.signal,
      deadlineMs: Date.now() + 7_000,
    });
    const catalogReward = catalog.entries.find(
      (candidate): candidate is CanonicalTokenExploreEntry =>
        candidate.exploreKind === "token" &&
        candidate.launchModelVersion === "classic-v3" &&
        candidate.rewardVaultAddress?.toLowerCase() ===
          vaultAddress.toLowerCase(),
    );
    if (
      !catalogReward ||
      catalogReward.rewardVaultAddress === undefined ||
      typeof catalogReward.buyHookFeeBps !== "number" ||
      typeof catalogReward.sellHookFeeBps !== "number"
    ) {
      return json(
        { error: "Only a current or historic payout wallet can continue" },
        403,
      );
    }
    const reward: ClassicActionRewardIdentity = {
      vaultAddress: catalogReward.rewardVaultAddress,
      poolId: catalogReward.poolId,
      buySwapFeeBps: catalogReward.buyHookFeeBps,
      sellSwapFeeBps: catalogReward.sellHookFeeBps,
      buyCreatorFeeBps: null,
      sellCreatorFeeBps: null,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: catalogReward.lpFeePips ?? 0,
    };
    const deployment = classicActionDeployment();
    const prepared = await withOperationalRpcFailover(
      deployment,
      async (selected) => {
        const client = createActionClient(selected.rpcUrl);
        const blockNumber = await currentActionBlock(client);
        const actionState = await readClassicActionState({
          client,
          reward,
          account,
          blockNumber,
          allocationIndex,
        });
        if (
          action === "update-payout" &&
          !actionState.ownsAllocation
        ) {
          return {
            status: 403,
            body: {
              error:
                "Only the current owner of this reward allocation can change it",
            },
          } as const;
        }
        if (
          action === "claim" &&
          BigInt(actionState.claimableWei) === 0n
        ) {
          return {
            status: 409,
            body: { error: "There are no rewards to claim" },
          } as const;
        }
        const data = encodeClassicV3RewardAction({
          action,
          allocationIndex,
          newPayoutAddress,
        });
        const transaction = {
          account,
          to: vaultAddress,
          data,
          value: 0n,
        };
        await client.call(transaction);
        const [estimatedGas, gasPrice, balance] = await Promise.all([
          client.estimateGas(transaction),
          client.getGasPrice(),
          client.getBalance({ address: account }),
        ]);
        const gasLimit = (estimatedGas * 120n + 99n) / 100n;
        if (balance < gasLimit * gasPrice) {
          return {
            status: 409,
            body: {
              error: "This wallet needs more ETH for the network fee",
            },
          } as const;
        }
        const kind =
          action === "claim"
            ? "claim-classic-v3-rewards"
            : "update-classic-v3-payout";
        return {
          status: 200,
          body: {
            status: "ready",
            action,
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
          },
        } as const;
      },
    );
    return json(prepared.body, prepared.status);
  } catch (error) {
    console.error(
      "Classic reward preparation failed",
      safeOperationalRpcError(error),
    );
    return json(
      { error: "The reward action could not be simulated from current onchain state" },
      502,
    );
  }
}
