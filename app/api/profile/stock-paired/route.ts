import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
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

import {
  getOnchainDeployment,
  readExploreModel,
} from "@/lib/onchain";
import { safeServerErrorSummary } from "@/lib/server/safe-error";
import {
  getStockQuoteAsset,
  stockFeeSplitVaultAbi,
  stockFeeSplitVaultFactoryAbi,
  stockPairedHookAbi,
} from "@/lib/stock-paired";
import { getConfiguredStockPairedRelease } from "@/lib/stock-paired-release";
import type { LauncherToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const ZERO_HASH = `0x${"0".repeat(64)}`;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function rpcEndpoints() {
  const primary =
    process.env.ETHEREUM_RPC_URL ??
    "https://ethereum-rpc.publicnode.com";
  const secondary =
    process.env.ETHEREUM_RPC_URL_B ??
    process.env.ETHEREUM_RPC_URL_SECONDARY ??
    (primary === "https://ethereum-rpc.publicnode.com"
      ? "https://rpc.mevblocker.io"
      : "https://ethereum-rpc.publicnode.com");
  if (primary === secondary) {
    throw new Error("Stock-Paired rewards require two independent RPCs");
  }
  return [primary, secondary] as const;
}

function clients() {
  return rpcEndpoints().map((endpoint) =>
    createPublicClient({
      chain: mainnet,
      batch: { multicall: true },
      transport: http(endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
  );
}

async function assertRuntime(
  client: PublicClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error(`${label} runtime does not match the verified release`);
  }
}

function entitlement(
  totalReceived: bigint,
  beneficiaries: readonly {
    beneficiary: Address;
    shareBps: number;
  }[],
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
  return beneficiaries.slice(0, -1).reduce(
    (remaining, item) =>
      remaining -
      (totalReceived * BigInt(item.shareBps)) / 10_000n,
    totalReceived,
  );
}

async function readVaultReward(
  client: PublicClient,
  token: LauncherToken,
  account: Address,
  snapshotBlock: bigint,
) {
  if (
    token.launchModel !== "stock-paired" ||
    !token.rewardVaultAddress ||
    !token.quoteAssetAddress ||
    !token.creatorAddress ||
    !token.launchTransactionHash
  ) {
    return null;
  }
  const release = getConfiguredStockPairedRelease();
  const quote = getStockQuoteAsset(token.quoteAssetAddress);
  if (!release || !quote) return null;
  const vault = getAddress(token.rewardVaultAddress);
  const [
    vaultCode,
    factoryVault,
    feeHook,
    poolId,
    quoteAsset,
    configurationHash,
    beneficiaryCount,
    accountShare,
    payoutAddress,
    claimed,
    totalReceived,
    poolFeeConfig,
  ] = await Promise.all([
    client.getCode({ address: vault, blockNumber: snapshotBlock }),
    client.readContract({
      address: release.addresses.feeSplitVaultFactory,
      abi: stockFeeSplitVaultFactoryAbi,
      functionName: "isFactoryVault",
      args: [vault],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "feeHook",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "poolId",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "quoteAsset",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "configurationHash",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "beneficiaryCount",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "shareBpsOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "payoutAddressOf",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "claimedBy",
      args: [account],
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: vault,
      abi: stockFeeSplitVaultAbi,
      functionName: "totalCreatorFeesReceived",
      blockNumber: snapshotBlock,
    }),
    client.readContract({
      address: release.addresses.feeHook,
      abi: stockPairedHookAbi,
      functionName: "poolFeeConfig",
      args: [token.poolId],
      blockNumber: snapshotBlock,
    }),
  ]);
  if (accountShare === 0) return null;
  if (
    !vaultCode ||
    vaultCode === "0x" ||
    !factoryVault ||
    getAddress(feeHook).toLowerCase() !==
      release.addresses.feeHook.toLowerCase() ||
    poolId.toLowerCase() !== token.poolId.toLowerCase() ||
    getAddress(quoteAsset).toLowerCase() !== quote.address.toLowerCase() ||
    configurationHash.toLowerCase() === ZERO_HASH ||
    beneficiaryCount < 1n ||
    beneficiaryCount > 8n
  ) {
    throw new Error(
      `Stock-Paired reward provenance mismatch for ${token.tokenAddress}`,
    );
  }
  const [
    configuredQuote,
    configuredToken,
    configuredVault,
    registrar,
    ,
    registered,
    creatorFeesAccrued,
  ] = poolFeeConfig;
  if (
    !registered ||
    getAddress(configuredQuote).toLowerCase() !==
      quote.address.toLowerCase() ||
    getAddress(configuredToken).toLowerCase() !==
      token.tokenAddress.toLowerCase() ||
    getAddress(configuredVault).toLowerCase() !== vault.toLowerCase() ||
    getAddress(registrar).toLowerCase() !==
      release.addresses.launcher.toLowerCase()
  ) {
    throw new Error(
      `Stock-Paired hook provenance mismatch for ${token.tokenAddress}`,
    );
  }

  const beneficiaryAddresses = await Promise.all(
    Array.from({ length: Number(beneficiaryCount) }, (_, index) =>
      client.readContract({
        address: vault,
        abi: stockFeeSplitVaultAbi,
        functionName: "beneficiaryAt",
        args: [BigInt(index)],
        blockNumber: snapshotBlock,
      }),
    ),
  );
  const beneficiaries = await Promise.all(
    beneficiaryAddresses.map(async (beneficiary) => {
      const normalized = getAddress(beneficiary);
      const [shareBps, payout] = await Promise.all([
        client.readContract({
          address: vault,
          abi: stockFeeSplitVaultAbi,
          functionName: "shareBpsOf",
          args: [normalized],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vault,
          abi: stockFeeSplitVaultAbi,
          functionName: "payoutAddressOf",
          args: [normalized],
          blockNumber: snapshotBlock,
        }),
      ]);
      return {
        beneficiary: normalized,
        payoutAddress: getAddress(payout),
        shareBps: Number(shareBps),
      };
    }),
  );
  if (
    new Set(
      beneficiaries.map((item) => item.beneficiary.toLowerCase()),
    ).size !== beneficiaries.length ||
    beneficiaries.some(
      (item) => item.shareBps <= 0 || item.shareBps > 10_000,
    ) ||
    beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !==
      10_000 ||
    !beneficiaries.some(
      (item) =>
        item.beneficiary.toLowerCase() === account.toLowerCase() &&
        item.shareBps === Number(accountShare),
    )
  ) {
    throw new Error(
      `Invalid Stock-Paired reward split for ${token.tokenAddress}`,
    );
  }
  const prospectiveTotalReceived =
    totalReceived + creatorFeesAccrued;
  const accountEntitlement = entitlement(
    prospectiveTotalReceived,
    beneficiaries,
    account,
  );
  const claimable =
    accountEntitlement > claimed ? accountEntitlement - claimed : 0n;

  return {
    model: "stock-paired" as const,
    tokenAddress: getAddress(token.tokenAddress),
    tokenName: token.name,
    tokenSymbol: token.symbol,
    ...(token.imageUrl ? { imageUrl: token.imageUrl } : {}),
    poolId: token.poolId,
    vaultAddress: vault,
    quoteAsset: quote.address,
    quoteAssetSymbol: quote.symbol,
    beneficiary: account,
    payoutAddress: getAddress(payoutAddress),
    shareBps: Number(accountShare),
    claimableRaw: claimable.toString(),
    claimable: formatUnits(claimable, 18),
    claimedRaw: claimed.toString(),
    claimed: formatUnits(claimed, 18),
    generatedRaw: accountEntitlement.toString(),
    generated: formatUnits(accountEntitlement, 18),
    creatorFeesPendingRaw: creatorFeesAccrued.toString(),
    beneficiaries,
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    programmableFeeBps: 10,
    launchTransactionHash: token.launchTransactionHash,
  };
}

async function readRewards(account: Address) {
  const release = getConfiguredStockPairedRelease();
  if (!release) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: 1 as const,
      rewards: [],
    };
  }
  const deployment = getOnchainDeployment("production");
  const model = await readExploreModel(deployment);
  if (model.status !== "ready") {
    throw new Error("The verified launch registry is unavailable");
  }
  const snapshotBlock = BigInt(model.snapshot.blockNumber);
  const rpcClients = clients();
  await Promise.all(
    rpcClients.flatMap((client) => [
      assertRuntime(
        client,
        release.addresses.feeHook,
        release.runtimeCodeHashes.feeHook,
        snapshotBlock,
        "Stock-Paired hook",
      ),
      assertRuntime(
        client,
        release.addresses.feeSplitVaultFactory,
        release.runtimeCodeHashes.feeSplitVaultFactory,
        snapshotBlock,
        "Stock-Paired reward-vault factory",
      ),
    ]),
  );
  const stockTokens = model.tokens.filter(
    (token) => token.launchModel === "stock-paired",
  );
  const rewardSets = await Promise.all(
    rpcClients.map(async (client) =>
      (
        await Promise.all(
          stockTokens.map((token) =>
            readVaultReward(client, token, account, snapshotBlock),
          ),
        )
      ).filter((reward): reward is NonNullable<typeof reward> =>
        Boolean(reward),
      ),
    ),
  );
  const fingerprint = JSON.stringify(rewardSets[0]);
  if (
    rewardSets.some(
      (candidate) => JSON.stringify(candidate) !== fingerprint,
    )
  ) {
    throw new Error(
      "Independent RPCs disagree on Stock-Paired rewards",
    );
  }
  return {
    status: "ready" as const,
    account,
    chainId: 1 as const,
    snapshotBlock: snapshotBlock.toString(),
    rewards: rewardSets[0],
  };
}

export async function GET(request: NextRequest) {
  const accountInput = request.nextUrl.searchParams.get("account")?.trim();
  if (!accountInput || !isAddress(accountInput)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    return json(await readRewards(getAddress(accountInput)));
  } catch (error) {
    console.error(
      "Stock-Paired profile read failed",
      safeServerErrorSummary(error),
    );
    return json(
      { error: "Stock-Paired rewards are temporarily unavailable" },
      503,
    );
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json({ error: "The reward request is too large" }, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The reward request is too large" }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send a valid reward request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "The reward request is missing" }, 400);
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "account",
    "vaultAddress",
    "newPayoutAddress",
    "chainId",
  ]);
  const unsupported = Object.keys(input).find((key) => !allowed.has(key));
  if (
    unsupported ||
    (input.action !== "claim" && input.action !== "update-payout") ||
    input.chainId !== 1 ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.vaultAddress !== "string" ||
    !isAddress(input.vaultAddress) ||
    (input.action === "update-payout" &&
      (typeof input.newPayoutAddress !== "string" ||
        !isAddress(input.newPayoutAddress) ||
        /^0x0{40}$/i.test(input.newPayoutAddress)))
  ) {
    return json({ error: "The reward request is invalid" }, 400);
  }

  try {
    const account = getAddress(input.account);
    const vaultAddress = getAddress(input.vaultAddress);
    const profile = await readRewards(account);
    if (profile.status !== "ready") {
      return json({ error: "Stock-Paired rewards are not deployed" }, 409);
    }
    const reward = profile.rewards.find(
      (candidate) =>
        candidate.vaultAddress.toLowerCase() ===
        vaultAddress.toLowerCase(),
    );
    if (!reward) {
      return json(
        { error: "This wallet is not a beneficiary of that reward vault" },
        403,
      );
    }
    if (input.action === "claim" && BigInt(reward.claimableRaw) === 0n) {
      return json({ error: "No Stock-Paired rewards are claimable" }, 409);
    }
    const data =
      input.action === "claim"
        ? encodeFunctionData({
            abi: stockFeeSplitVaultAbi,
            functionName: "claim",
          })
        : encodeFunctionData({
            abi: stockFeeSplitVaultAbi,
            functionName: "setPayoutAddress",
            args: [getAddress(input.newPayoutAddress as string)],
          });
    const rpcClients = clients();
    const requestForRpc = {
      account,
      to: vaultAddress,
      data,
      value: 0n,
    };
    await Promise.all(
      rpcClients.map((client) => client.call(requestForRpc)),
    );
    const estimates = await Promise.all(
      rpcClients.map((client) => client.estimateGas(requestForRpc)),
    );
    const gasLimit =
      ((estimates.reduce(
        (largest, candidate) =>
          candidate > largest ? candidate : largest,
        0n,
      ) *
        120n) +
        99n) /
      100n;
    if (gasLimit <= 0n) {
      throw new Error("The reward transaction gas estimate is invalid");
    }
    return json({
      status: "ready",
      account,
      vaultAddress,
      action: input.action,
      transaction: {
        kind:
          input.action === "claim"
            ? "claim-stock-paired-rewards"
            : "update-stock-paired-payout",
        chainId: 1,
        from: account,
        to: vaultAddress,
        data,
        value: "0",
        gasLimit: gasLimit.toString(),
      },
    });
  } catch (error) {
    console.error(
      "Stock-Paired reward preparation failed",
      safeServerErrorSummary(error),
    );
    return json(
      {
        error:
          "The Stock-Paired reward action could not be prepared from the current onchain state",
      },
      503,
    );
  }
}
