import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import {
  creatorFeeHookReadAbi,
  creatorFeesClaimedEvent,
  memeTokenLaunchedEvent,
  uerc20ReadAbi,
} from "@/lib/onchain/abis";
import type {
  CreatorClaim,
  CreatorProfile,
} from "@/lib/onchain/types";
import { getWebsiteReadOnchainDeployment } from "@/lib/onchain";
import { withOperationalRpcFailover } from
  "@/lib/onchain/operational-rpc-failover.server";
import { creatorProfileApiError } from "@/lib/profile/onchain-profile";
import type {
  CanonicalTokenExploreEntry,
  LauncherToken,
} from "@/lib/tokens";
import { readEnvioClassicV2CreatorClaimsV1 } from
  "@/lib/market-data/envio-classic-v2-creator-claims.server";
import { readEnvioClassicV3CatalogV1 } from
  "@/lib/market-data/envio-classic-v3-catalog.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIRMATIONS = 12n;
const LOG_RANGE = 10_000n;
const LOG_RANGE_CONCURRENCY = 2;
const TOTAL_SUPPLY_RAW = "1000000000000000000000000000";
const LEGACY_RPC_PROFILE_FALLBACK_ENABLED: boolean = false;

type Release = Readonly<{
  launcher: Address;
  hook: Address;
  launcherRuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
  startBlock: bigint;
}>;

type ProfileLaunch = Readonly<{
  release: Release;
  creator: Address;
  token: Address;
  poolId: Hex;
  positionRecipient: Address;
  positionTokenId: bigint;
  totalSwapFeeBps: number;
  launchHash: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
}>;

type DeploymentShape = Readonly<{
  production: Readonly<{
    memeLaunch: string;
    ethCreatorFeeHook: string;
    runtimeCodeHashes: Readonly<{
      memeLaunch: string;
      ethCreatorFeeHook: string;
    }>;
    deploymentBlocks: Readonly<{ memeLaunch: number }>;
    historicalV1Deployment: Readonly<{
      memeLaunch: string;
      ethCreatorFeeHook: string;
      runtimeCodeHashes: Readonly<{
        memeLaunch: string;
        ethCreatorFeeHook: string;
      }>;
      deploymentBlocks: Readonly<{ memeLaunch: number }>;
    }>;
  }>;
}>;

function releases(): readonly Release[] {
  const production = (appDeployments as unknown as DeploymentShape).production;
  const historical = production.historicalV1Deployment;
  return [
    {
      launcher: getAddress(historical.memeLaunch),
      hook: getAddress(historical.ethCreatorFeeHook),
      launcherRuntimeCodeHash: historical.runtimeCodeHashes.memeLaunch as Hex,
      hookRuntimeCodeHash: historical.runtimeCodeHashes.ethCreatorFeeHook as Hex,
      startBlock: BigInt(historical.deploymentBlocks.memeLaunch),
    },
    {
      launcher: getAddress(production.memeLaunch),
      hook: getAddress(production.ethCreatorFeeHook),
      launcherRuntimeCodeHash: production.runtimeCodeHashes.memeLaunch as Hex,
      hookRuntimeCodeHash: production.runtimeCodeHashes.ethCreatorFeeHook as Hex,
      startBlock: BigInt(production.deploymentBlocks.memeLaunch),
    },
  ];
}

function profileClient(rpcUrl: string) {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 1, timeout: 12_000 }),
  });
}

function profileRpcProviderHeader(
  deployment: ReturnType<typeof getWebsiteReadOnchainDeployment>,
  rpcUrl: string,
) {
  const role = rpcUrl === deployment.rpcUrl ? "primary" : "secondary";
  const provider = deployment.rpcProviderIds?.[role] ?? "rpc";
  return `${provider}-${role}`;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

async function readBoundedLogRanges<Log>(
  fromBlock: bigint,
  toBlock: bigint,
  readRange: (fromBlock: bigint, toBlock: bigint) => Promise<readonly Log[]>,
) {
  const ranges: Array<readonly [bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_RANGE) {
    ranges.push([start, minimum(toBlock, start + LOG_RANGE - 1n)]);
  }
  const results: Log[][] = Array.from({ length: ranges.length }, () => []);
  let nextRange = 0;
  const workerCount = Math.min(LOG_RANGE_CONCURRENCY, ranges.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextRange < ranges.length) {
      const index = nextRange++;
      const range = ranges[index]!;
      results[index] = [...await readRange(range[0], range[1])];
    }
  }));
  return results.flat();
}

async function assertRuntime(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code || code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error("Creator profile runtime does not match its manifest");
  }
}

async function readLaunches(
  client: PublicClient,
  release: Release,
  account: Address,
  toBlock: bigint,
) {
  const launches: ProfileLaunch[] = [];
  const logs = await readBoundedLogRanges(
    release.startBlock,
    toBlock,
    (fromBlock, rangeToBlock) => client.getLogs({
      address: release.launcher,
      event: memeTokenLaunchedEvent,
      args: { creator: account },
      fromBlock,
      toBlock: rangeToBlock,
      strict: true,
    }),
  );
  for (const log of logs) {
    if (log.removed) continue;
    if (
      log.blockNumber === null ||
      log.transactionHash === null || log.transactionIndex === null ||
      log.logIndex === null
    ) {
      throw new Error("Creator launch identity is incomplete");
    }
    if (
      log.args.creator.toLowerCase() !== account.toLowerCase() ||
      log.args.feeHook.toLowerCase() !== release.hook.toLowerCase()
    ) {
      throw new Error("Creator launch identity does not match its manifest");
    }
    launches.push({
      release,
      creator: getAddress(log.args.creator),
      token: getAddress(log.args.token),
      poolId: log.args.poolId,
      positionRecipient: getAddress(log.args.positionRecipient),
      positionTokenId: log.args.positionTokenId,
      totalSwapFeeBps: log.args.totalSwapFeeBps,
      launchHash: log.args.launchHash,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
    });
  }
  return launches;
}

async function readClaims(
  client: PublicClient,
  release: Release,
  account: Address,
  launches: readonly ProfileLaunch[],
  toBlock: bigint,
) {
  if (launches.length === 0) return [];
  const poolIds = launches.map((launch) => launch.poolId);
  const tokenByPool = new Map(
    launches.map((launch) => [launch.poolId.toLowerCase(), launch.token]),
  );
  const claims = [];
  const logs = await readBoundedLogRanges(
    release.startBlock,
    toBlock,
    (fromBlock, rangeToBlock) => client.getLogs({
      address: release.hook,
      event: creatorFeesClaimedEvent,
      args: { poolId: poolIds, creator: account },
      fromBlock,
      toBlock: rangeToBlock,
      strict: true,
    }),
  );
  for (const log of logs) {
    if (log.removed) continue;
    if (
      log.blockNumber === null ||
      log.transactionHash === null || log.transactionIndex === null ||
      log.logIndex === null
    ) {
      throw new Error("Creator claim identity is incomplete");
    }
    if (
      log.args.creator.toLowerCase() !== account.toLowerCase() ||
      !tokenByPool.has(log.args.poolId.toLowerCase())
    ) {
      throw new Error("Creator claim is outside its verified profile");
    }
    claims.push({ log, token: tokenByPool.get(log.args.poolId.toLowerCase())! });
  }
  return claims;
}

async function readCreatorProfile(
  account: Address,
  client: PublicClient,
): Promise<CreatorProfile> {
  const head = await client.getBlockNumber();
  const snapshotBlock = head > CONFIRMATIONS ? head - CONFIRMATIONS : head;
  const snapshot = await client.getBlock({ blockNumber: snapshotBlock });
  if (!snapshot.hash) throw new Error("Creator profile snapshot has no block hash");

  const releaseValues = releases();
  await Promise.all(releaseValues.flatMap((release) => [
    assertRuntime(
      client,
      release.launcher,
      release.launcherRuntimeCodeHash,
      snapshotBlock,
    ),
    assertRuntime(
      client,
      release.hook,
      release.hookRuntimeCodeHash,
      snapshotBlock,
    ),
  ]));
  const launchesByRelease = await Promise.all(
    releaseValues.map((release) =>
      snapshotBlock < release.startBlock
        ? Promise.resolve([])
        : readLaunches(client, release, account, snapshotBlock)
    ),
  );
  const claimGroups = await Promise.all(
    releaseValues.map((release, index) =>
      readClaims(
        client,
        release,
        account,
        launchesByRelease[index]!,
        snapshotBlock,
      )
    ),
  );
  const launches = launchesByRelease.flat();
  if (
    new Set(launches.map((launch) => launch.poolId.toLowerCase())).size !==
      launches.length ||
    new Set(launches.map((launch) => launch.token.toLowerCase())).size !==
      launches.length
  ) {
    throw new Error("Creator profile contains duplicate launch identity");
  }

  const relevantBlocks = [...new Set([
    ...launches.map((launch) => launch.blockNumber.toString()),
    ...claimGroups.flat().map(({ log }) => log.blockNumber!.toString()),
  ])];
  const timestamps = new Map<string, bigint>();
  await Promise.all(relevantBlocks.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
    timestamps.set(blockNumber, block.timestamp);
  }));

  const claims: CreatorClaim[] = claimGroups.flat()
    .map(({ log, token }) => {
      const timestamp = timestamps.get(log.blockNumber!.toString());
      if (timestamp === undefined) {
        throw new Error("Creator claim time is unavailable");
      }
      return {
        poolId: log.args.poolId,
        tokenAddress: token,
        creatorAddress: getAddress(log.args.creator),
        recipientAddress: getAddress(log.args.recipient),
        callerAddress: getAddress(log.args.caller),
        amountWei: log.args.amount.toString(),
        amountEth: formatUnits(log.args.amount, 18),
        blockNumber: log.blockNumber!.toString(),
        transactionHash: log.transactionHash!,
        transactionIndex: log.transactionIndex!,
        logIndex: log.logIndex!,
        claimedAt: new Date(Number(timestamp) * 1_000).toISOString(),
      };
    })
    .sort((left, right) => {
      const blockDifference = BigInt(right.blockNumber) - BigInt(left.blockNumber);
      if (blockDifference !== 0n) return blockDifference < 0n ? -1 : 1;
      if (left.transactionIndex !== right.transactionIndex) {
        return right.transactionIndex - left.transactionIndex;
      }
      return right.logIndex - left.logIndex;
    });
  const claimedByPool = new Map<string, bigint>();
  for (const claim of claims) {
    const key = claim.poolId.toLowerCase();
    claimedByPool.set(key, (claimedByPool.get(key) ?? 0n) + BigInt(claim.amountWei));
  }

  const hydrated = await Promise.all(launches.map(async (launch) => {
    const [name, symbol, poolConfig] = await Promise.all([
      client.readContract({
        address: launch.token,
        abi: uerc20ReadAbi,
        functionName: "name",
        blockNumber: snapshotBlock,
      }),
      client.readContract({
        address: launch.token,
        abi: uerc20ReadAbi,
        functionName: "symbol",
        blockNumber: snapshotBlock,
      }),
      client.readContract({
        address: launch.release.hook,
        abi: creatorFeeHookReadAbi,
        functionName: "poolFeeConfig",
        args: [launch.poolId],
        blockNumber: snapshotBlock,
      }),
    ]);
    const [creator, registrar, totalSwapFeeBps, registered, accrued] = poolConfig;
    if (
      !registered || creator.toLowerCase() !== account.toLowerCase() ||
      registrar.toLowerCase() !== launch.release.launcher.toLowerCase() ||
      totalSwapFeeBps !== launch.totalSwapFeeBps
    ) {
      throw new Error("Creator reward pool does not match its launch identity");
    }
    const claimed = claimedByPool.get(launch.poolId.toLowerCase()) ?? 0n;
    const timestamp = timestamps.get(launch.blockNumber.toString());
    if (timestamp === undefined) throw new Error("Creator launch time is unavailable");
    const token: LauncherToken = {
      id: launch.token.toLowerCase(),
      name,
      symbol,
      tokenAddress: launch.token,
      hookAddress: launch.release.hook,
      poolId: launch.poolId,
      creatorAddress: launch.creator,
      positionRecipient: launch.positionRecipient,
      positionTokenId: launch.positionTokenId.toString(),
      launchHash: launch.launchHash,
      launchBlockNumber: launch.blockNumber.toString(),
      launchTransactionHash: launch.transactionHash,
      launchTransactionIndex: launch.transactionIndex,
      launchLogIndex: launch.logIndex,
      launchedAt: new Date(Number(timestamp) * 1_000).toISOString(),
      totalSupply: "1000000000",
      totalSupplyRaw: TOTAL_SUPPLY_RAW,
      tokenDecimals: 18,
      totalSwapFeeBps: launch.totalSwapFeeBps,
      buyHookFeeBps: launch.totalSwapFeeBps,
      sellHookFeeBps: launch.totalSwapFeeBps,
      creatorFeesAccruedWei: accrued.toString(),
      creatorFeesAccruedEth: formatUnits(accrued, 18),
      creatorFeesGeneratedWei: (accrued + claimed).toString(),
      creatorFeesGeneratedEth: formatUnits(accrued + claimed, 18),
      launchModel: "classic",
      liquidityPath: "meme",
    };
    return { token, accrued, claimed };
  }));

  const pools = hydrated.map(({ token }) => ({
    tokenAddress: getAddress(token.tokenAddress),
    name: token.name,
    symbol: token.symbol,
    poolId: token.poolId as Hex,
    totalSwapFeeBps: token.totalSwapFeeBps!,
    launchModel: "classic" as const,
    claimableCreatorFeesWei: token.creatorFeesAccruedWei!,
    claimableCreatorFeesEth: token.creatorFeesAccruedEth!,
    generatedCreatorFeesWei: token.creatorFeesGeneratedWei!,
    generatedCreatorFeesEth: token.creatorFeesGeneratedEth!,
  }));
  const claimable = hydrated.reduce((sum, value) => sum + value.accrued, 0n);
  const claimed = hydrated.reduce((sum, value) => sum + value.claimed, 0n);
  return {
    status: "ready",
    account,
    tokens: hydrated.map(({ token }) => token),
    pools,
    claims,
    totals: {
      claimableWei: claimable.toString(),
      claimableEth: formatUnits(claimable, 18),
      generatedWei: (claimable + claimed).toString(),
      generatedEth: formatUnits(claimable + claimed, 18),
      claimedWei: claimed.toString(),
      claimedEth: formatUnits(claimed, 18),
    },
    snapshot: {
      chainId: 1,
      blockNumber: snapshotBlock.toString(),
      blockHash: snapshot.hash,
      blockTimestamp: new Date(Number(snapshot.timestamp) * 1_000).toISOString(),
      confirmations: Number(head - snapshotBlock),
    },
  };
}

async function readEnvioCreatorProfile(
  account: Address,
  signal: AbortSignal,
): Promise<Readonly<{
  profile: CreatorProfile;
  provider: string;
}>> {
  const catalog = await readEnvioClassicV3CatalogV1({
    signal,
    deadlineMs: Date.now() + 7_500,
  });
  const tokens = catalog.entries
    .filter(
      (entry): entry is CanonicalTokenExploreEntry =>
        entry.exploreKind === "token" &&
        entry.creatorAddress?.toLowerCase() === account.toLowerCase(),
    )
    .map((token) => ({
      ...token,
      id: token.tokenAddress.toLowerCase(),
    }));
  const classicV2Tokens = tokens.filter(
    (token) => token.launchModelVersion === "classic-v2",
  );
  const [claimState, classicV2Claims] = await Promise.all([
    classicV2Tokens.length
      ? (async () => {
        const deployment = getWebsiteReadOnchainDeployment("production");
        if (deployment.status !== "ready") {
          throw new Error("Classic V2 creator rewards are not deployed");
        }
        return withOperationalRpcFailover(deployment, async (selected) => {
          const client = profileClient(selected.rpcUrl);
          const head = await client.getBlockNumber();
          const blockNumber = head > CONFIRMATIONS ? head - CONFIRMATIONS : head;
          const block = await client.getBlock({ blockNumber });
          if (!block.hash) {
            throw new Error("Creator reward snapshot has no block hash");
          }
          await Promise.all([
            assertRuntime(
              client,
              deployment.launcher,
              deployment.launcherRuntimeCodeHash,
              blockNumber,
            ),
            assertRuntime(
              client,
              deployment.feeHook,
              deployment.feeHookRuntimeCodeHash,
              blockNumber,
            ),
          ]);
          const claimableByPool = new Map<string, bigint>();
          await Promise.all(classicV2Tokens.map(async (token) => {
            if (
              token.hookAddress.toLowerCase() !==
                deployment.feeHook.toLowerCase() ||
              typeof token.totalSwapFeeBps !== "number"
            ) {
              throw new Error("Classic V2 reward identity is invalid");
            }
            const config = await client.readContract({
              address: deployment.feeHook,
              abi: creatorFeeHookReadAbi,
              functionName: "poolFeeConfig",
              args: [token.poolId],
              blockNumber,
            });
            const [creator, registrar, totalSwapFeeBps, registered, accrued] =
              config;
            if (
              !registered ||
              getAddress(creator).toLowerCase() !== account.toLowerCase() ||
              getAddress(registrar).toLowerCase() !==
                deployment.launcher.toLowerCase() ||
              Number(totalSwapFeeBps) !== token.totalSwapFeeBps
            ) {
              throw new Error("Classic V2 reward state is invalid");
            }
            claimableByPool.set(token.poolId.toLowerCase(), accrued);
          }));
          return {
            blockNumber,
            blockHash: block.hash as Hex,
            blockTimestamp: block.timestamp,
            confirmations: Number(head - blockNumber),
            claimableByPool,
            provider: profileRpcProviderHeader(deployment, selected.rpcUrl),
          };
        });
      })()
      : Promise.resolve(null),
    classicV2Tokens.length
      ? readEnvioClassicV2CreatorClaimsV1({
          account,
          poolIds: classicV2Tokens.map((token) => token.poolId),
          throughBlock: catalog.asOfBlock,
          signal,
          deadlineMs: Date.now() + 5_000,
        })
      : Promise.resolve([]),
  ]);
  const claimedByPool = new Map<string, bigint>();
  for (const claim of classicV2Claims) {
    const key = claim.poolId.toLowerCase();
    claimedByPool.set(
      key,
      (claimedByPool.get(key) ?? 0n) + BigInt(claim.amountWei),
    );
  }
  const tokenByPool = new Map(
    classicV2Tokens.map((token) => [token.poolId.toLowerCase(), token]),
  );
  const claims: CreatorClaim[] = classicV2Claims.map((claim) => {
    const token = tokenByPool.get(claim.poolId.toLowerCase());
    if (!token) throw new Error("Classic V2 claim token identity is unavailable");
    return {
      poolId: claim.poolId,
      tokenAddress: token.tokenAddress,
      creatorAddress: claim.creator,
      recipientAddress: claim.recipient,
      callerAddress: claim.caller,
      amountWei: claim.amountWei,
      amountEth: formatUnits(BigInt(claim.amountWei), 18),
      blockNumber: claim.blockNumber,
      transactionHash: claim.transactionHash,
      transactionIndex: claim.transactionIndex,
      logIndex: claim.logIndex,
      claimedAt:
        new Date(Number(claim.blockTimestamp) * 1_000).toISOString(),
    };
  });
  const pools = tokens.flatMap((token) =>
    typeof token.totalSwapFeeBps === "number"
      ? (() => {
          const claimable =
            claimState?.claimableByPool.get(token.poolId.toLowerCase()) ?? 0n;
          const claimed = claimedByPool.get(token.poolId.toLowerCase()) ?? 0n;
          return [{
            tokenAddress: token.tokenAddress,
            name: token.name,
            symbol: token.symbol,
            poolId: token.poolId,
            totalSwapFeeBps: token.totalSwapFeeBps,
            launchModel: "classic" as const,
            claimableCreatorFeesWei: claimable.toString(),
            claimableCreatorFeesEth: formatUnits(claimable, 18),
            generatedCreatorFeesWei: (claimable + claimed).toString(),
            generatedCreatorFeesEth: formatUnits(claimable + claimed, 18),
          }];
        })()
      : [],
  );
  const claimable = [...(claimState?.claimableByPool.values() ?? [])]
    .reduce((sum, value) => sum + value, 0n);
  const claimed = [...claimedByPool.values()]
    .reduce((sum, value) => sum + value, 0n);
  return {
    provider: claimState?.provider ?? "envio-indexer-state",
    profile: {
      status: "ready",
      account,
      tokens,
      pools,
      claims,
      totals: {
        claimableWei: claimable.toString(),
        claimableEth: formatUnits(claimable, 18),
        generatedWei: (claimable + claimed).toString(),
        generatedEth: formatUnits(claimable + claimed, 18),
        claimedWei: claimed.toString(),
        claimedEth: formatUnits(claimed, 18),
      },
      snapshot: claimState
        ? {
            chainId: 1,
            blockNumber: claimState.blockNumber.toString(),
            blockHash: claimState.blockHash,
            blockTimestamp:
              new Date(Number(claimState.blockTimestamp) * 1_000).toISOString(),
            confirmations: claimState.confirmations,
          }
        : {
            chainId: 1,
            blockNumber: catalog.asOfBlock,
            blockHash: catalog.asOfBlockHash,
            blockTimestamp: catalog.generatedAt,
            confirmations: 12,
          },
    },
  };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "account") ||
    search.getAll("account").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum account address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await readEnvioCreatorProfile(
      getAddress(input),
      request.signal,
    );
    return NextResponse.json(result.profile, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=15",
        "X-Programmable-Launch-Source": "envio-classic-v3",
        "X-Programmable-Read-Source":
          result.provider === "envio-indexer-state"
            ? "envio-classic-v3"
            : "envio-classic-v3+rpc",
        "X-Programmable-Rpc-Provider": result.provider,
      },
    });
  } catch (error) {
    console.error("Envio creator profile read failed", {
      name: error instanceof Error ? error.name : "EnvioCreatorProfileError",
      category: "read-failed",
    });
    if (LEGACY_RPC_PROFILE_FALLBACK_ENABLED) {
      try {
        const deployment = getWebsiteReadOnchainDeployment("production");
        const fallback = await withOperationalRpcFailover(
          deployment,
          async (selected) => ({
            profile: await readCreatorProfile(
              getAddress(input),
              profileClient(selected.rpcUrl),
            ),
            provider: profileRpcProviderHeader(deployment, selected.rpcUrl),
          }),
        );
        return NextResponse.json(fallback.profile, {
          headers: {
            "Cache-Control": "private, max-age=0, s-maxage=15",
            "X-Programmable-Launch-Source": "rpc",
            "X-Programmable-Read-Source": "rpc",
            "X-Programmable-Rpc-Provider": fallback.provider,
          },
        });
      } catch (fallbackError) {
        console.error("Legacy creator profile fallback failed", {
          name:
            fallbackError instanceof Error
              ? fallbackError.name
              : "LegacyCreatorProfileError",
        });
      }
    }
    return NextResponse.json(creatorProfileApiError("temporary"), {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
